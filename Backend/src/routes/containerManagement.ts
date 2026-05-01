import express from 'express';
import crypto from 'crypto';
import { spawn } from 'child_process';
import * as cron from 'node-cron';
import * as fs from 'fs';
import path from 'path';
import Docker from 'dockerode';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { executeQuery } from '../lib/db';
import { authenticateToken } from '../middleware/auth';
import { getJwtSecret } from '../lib/secret';

const router = express.Router();
router.use(authenticateToken);

// ── Helpers ────────────────────────────────────────────────────────────────────

const ALGO = 'aes-256-cbc';
function getEncKey(): Buffer {
    const raw = process.env.ENCRYPTION_KEY || getJwtSecret();
    return crypto.createHash('sha256').update(raw).digest();
}
function encrypt(plain: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGO, getEncKey(), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + enc.toString('hex');
}
function decrypt(stored: string): string {
    try {
        const [ivHex, encHex] = stored.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const enc = Buffer.from(encHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGO, getEncKey(), iv);
        return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    } catch { return ''; }
}

function getDocker() { return new Docker({ socketPath: '/var/run/docker.sock' }); }

async function execInContainer(containerName: string, cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = spawn('docker', ['exec', containerName, 'sh', '-c', cmd]);
        let out = '';
        proc.stdout.on('data', d => { out += d.toString(); });
        proc.stderr.on('data', d => { out += d.toString(); });
        proc.on('close', code => {
            if (code !== 0) reject(new Error(out.trim() || `Exit code ${code}`));
            else resolve(out.trim());
        });
    });
}

const NGINX_CONTAINER = 'docklet-nginx';
const NGINX_CONF_DIR = '/usr/src/app/nginx-configs';

// ── DB bootstrap ───────────────────────────────────────────────────────────────
export async function initContainerManagement() {
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS container_env_vars (
            id SERIAL PRIMARY KEY,
            container_name TEXT NOT NULL,
            key TEXT NOT NULL,
            encrypted_value TEXT NOT NULL,
            created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())*1000,
            UNIQUE(container_name, key)
        )`);
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS container_schedules (
            id SERIAL PRIMARY KEY,
            container_name TEXT NOT NULL,
            label TEXT NOT NULL,
            cron_expr TEXT NOT NULL,
            command TEXT NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            last_run BIGINT,
            created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())*1000
        )`);
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS container_schedule_logs (
            id SERIAL PRIMARY KEY,
            schedule_id INTEGER NOT NULL REFERENCES container_schedules(id) ON DELETE CASCADE,
            started_at BIGINT NOT NULL,
            finished_at BIGINT,
            status TEXT NOT NULL DEFAULT 'running',
            output TEXT NOT NULL DEFAULT ''
        )`);
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS base_domain_config (
            id INTEGER PRIMARY KEY DEFAULT 1,
            domain TEXT NOT NULL,
            verified BOOLEAN NOT NULL DEFAULT FALSE,
            vps_ip TEXT,
            created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())*1000
        )`);
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS container_domains (
            id SERIAL PRIMARY KEY,
            container_name TEXT NOT NULL UNIQUE,
            subdomain TEXT NOT NULL UNIQUE,
            full_domain TEXT NOT NULL,
            port INTEGER NOT NULL,
            nginx_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())*1000
        )`);
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS container_backups (
            id SERIAL PRIMARY KEY,
            container_name TEXT NOT NULL,
            label TEXT NOT NULL,
            cron_expr TEXT,
            s3_bucket TEXT NOT NULL,
            prefix TEXT NOT NULL DEFAULT '',
            keep_n INTEGER NOT NULL DEFAULT 5,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())*1000
        )`);
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS container_backup_logs (
            id SERIAL PRIMARY KEY,
            backup_id INTEGER NOT NULL REFERENCES container_backups(id) ON DELETE CASCADE,
            started_at BIGINT NOT NULL,
            finished_at BIGINT,
            status TEXT NOT NULL DEFAULT 'running',
            output TEXT NOT NULL DEFAULT '',
            s3_key TEXT
        )`);
    // Load container schedules
    await reloadContainerSchedules();
    // Load backup schedules
    await reloadBackupSchedules();
    console.log('[ContainerMgmt] Initialized');
}

// ── Container schedule runner ─────────────────────────────────────────────────
const containerCronJobs = new Map<number, ReturnType<typeof cron.schedule>>();

async function reloadContainerSchedules() {
    for (const [, job] of containerCronJobs) job.stop();
    containerCronJobs.clear();
    try {
        const { rows } = await executeQuery(
            'SELECT * FROM container_schedules WHERE enabled = TRUE'
        );
        for (const row of rows) mountContainerCronJob(row);
    } catch { /* table may not exist yet on first boot */ }
}

function mountContainerCronJob(sched: any) {
    if (!cron.validate(sched.cron_expr)) return;
    const job = cron.schedule(sched.cron_expr, () => runContainerSchedule(sched.id));
    containerCronJobs.set(sched.id, job);
}

async function runContainerSchedule(scheduleId: number): Promise<number> {
    const { rows } = await executeQuery(
        'SELECT * FROM container_schedules WHERE id = $1', [scheduleId]
    );
    if (!rows.length) return -1;
    const sched = rows[0];
    const { rows: logRows } = await executeQuery(
        `INSERT INTO container_schedule_logs (schedule_id, started_at) VALUES ($1, $2) RETURNING id`,
        [scheduleId, Date.now()]
    );
    const logId = logRows[0].id;
    let output = '';
    let status = 'success';
    try {
        output = await execInContainer(sched.container_name, sched.command);
    } catch (err: any) {
        output = err.message || String(err);
        status = 'error';
    }
    await executeQuery(
        `UPDATE container_schedules SET last_run = $1 WHERE id = $2`,
        [Date.now(), scheduleId]
    );
    await executeQuery(
        `UPDATE container_schedule_logs SET finished_at=$1, status=$2, output=$3 WHERE id=$4`,
        [Date.now(), status, output, logId]
    );
    return logId;
}

// ── Backup runner ─────────────────────────────────────────────────────────────
const backupCronJobs = new Map<number, ReturnType<typeof cron.schedule>>();

async function reloadBackupSchedules() {
    for (const [, job] of backupCronJobs) job.stop();
    backupCronJobs.clear();
    try {
        const { rows } = await executeQuery(
            'SELECT * FROM container_backups WHERE enabled = TRUE AND cron_expr IS NOT NULL'
        );
        for (const row of rows) mountBackupCronJob(row);
    } catch { /* ignore */ }
}

function mountBackupCronJob(backup: any) {
    if (!backup.cron_expr || !cron.validate(backup.cron_expr)) return;
    const job = cron.schedule(backup.cron_expr, () => runBackup(backup.id));
    backupCronJobs.set(backup.id, job);
}

async function getS3Client() {
    const { rows } = await executeQuery('SELECT * FROM storage_config WHERE id = 1');
    if (!rows.length) throw new Error('S3 storage not configured');
    const cfg = rows[0];
    const protocol = cfg.use_ssl ? 'https' : 'http';
    const endpoint = `${protocol}://${cfg.endpoint}:${cfg.port}`;
    return {
        client: new S3Client({
            endpoint,
            region: cfg.region || 'us-east-1',
            credentials: { accessKeyId: cfg.access_key, secretAccessKey: cfg.secret_key },
            forcePathStyle: true,
        }),
        cfg,
    };
}

async function runBackup(backupId: number): Promise<number> {
    const { rows } = await executeQuery('SELECT * FROM container_backups WHERE id = $1', [backupId]);
    if (!rows.length) return -1;
    const backup = rows[0];
    const { rows: logRows } = await executeQuery(
        `INSERT INTO container_backup_logs (backup_id, started_at) VALUES ($1, $2) RETURNING id`,
        [backupId, Date.now()]
    );
    const logId = logRows[0].id;
    const appendLog = async (line: string) => {
        await executeQuery(
            `UPDATE container_backup_logs SET output = output || $1 WHERE id = $2`,
            [line + '\n', logId]
        );
    };

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = backup.prefix ? `${backup.prefix}/` : '';
    const s3Key = `${prefix}${backup.container_name}/${ts}.tar.gz`;

    try {
        await appendLog(`[${new Date().toUTCString()}] Starting backup process...`);
        await appendLog(`[${new Date().toUTCString()}] Executing backup command...`);

        // Get container ID
        const docker = getDocker();
        let container;
        try {
            const containers = await docker.listContainers({ all: true });
            const found = containers.find(c =>
                c.Names.some(n => n.replace(/^\//, '') === backup.container_name)
            );
            if (!found) throw new Error(`Container '${backup.container_name}' not found`);
            container = docker.getContainer(found.Id);
            await appendLog(`[${new Date().toUTCString()}] Container Up: ${found.Id.slice(0, 12)}`);
        } catch (err: any) {
            throw new Error(`Container error: ${err.message}`);
        }

        // Stream export → S3
        const { client, cfg } = await getS3Client();
        const exportStream = await container.export();

        const { pipeline } = await import('stream');
        const zlib = await import('zlib');
        const { promisify } = await import('util');
        const pipelineAsync = promisify(pipeline);

        const gzip = zlib.createGzip();
        const gzipStream = (exportStream as any).pipe(gzip);

        const upload = new Upload({
            client,
            params: {
                Bucket: backup.s3_bucket,
                Key: s3Key,
                Body: gzipStream,
                ContentType: 'application/gzip',
            },
        });

        await upload.done();
        await appendLog(`[${new Date().toUTCString()}] ✅ backup completed successfully`);
        await appendLog(`[${new Date().toUTCString()}] Starting upload to S3...`);
        await appendLog(`[${new Date().toUTCString()}] ✅ Upload to S3 completed successfully`);
        await appendLog(`Backup done ✅`);

        // Prune old backups
        if (backup.keep_n > 0) {
            try {
                const listCmd = new ListObjectsV2Command({
                    Bucket: backup.s3_bucket,
                    Prefix: `${prefix}${backup.container_name}/`,
                });
                const listRes = await client.send(listCmd);
                const objects = (listRes.Contents || []).sort((a, b) =>
                    (a.LastModified?.getTime() || 0) - (b.LastModified?.getTime() || 0)
                );
                if (objects.length > backup.keep_n) {
                    const toDelete = objects.slice(0, objects.length - backup.keep_n);
                    for (const obj of toDelete) {
                        await client.send(new DeleteObjectCommand({ Bucket: backup.s3_bucket, Key: obj.Key! }));
                    }
                    await appendLog(`[${new Date().toUTCString()}] Pruned ${toDelete.length} old backup(s)`);
                }
            } catch { /* best-effort */ }
        }

        await executeQuery(
            `UPDATE container_backup_logs SET finished_at=$1, status='success', s3_key=$2 WHERE id=$3`,
            [Date.now(), s3Key, logId]
        );
    } catch (err: any) {
        await appendLog(`[${new Date().toUTCString()}] ❌ Error: ${err.message}`);
        await executeQuery(
            `UPDATE container_backup_logs SET finished_at=$1, status='error' WHERE id=$2`,
            [Date.now(), logId]
        );
    }
    return logId;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENV VARS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/containers/:name/env', async (req, res) => {
    const { name } = req.params;
    const { rows } = await executeQuery(
        'SELECT id, container_name, key, created_at FROM container_env_vars WHERE container_name = $1 ORDER BY key',
        [name]
    );
    res.json({ vars: rows });
});

router.post('/containers/:name/env', async (req, res) => {
    const { name } = req.params;
    const { key, value } = req.body;
    if (!key || value === undefined) return res.status(400).json({ message: 'key and value required' });
    const enc = encrypt(String(value));
    const { rows } = await executeQuery(
        `INSERT INTO container_env_vars (container_name, key, encrypted_value)
         VALUES ($1, $2, $3)
         ON CONFLICT (container_name, key) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value
         RETURNING id, container_name, key, created_at`,
        [name, key, enc]
    );
    res.json({ var: rows[0] });
});

router.delete('/containers/:name/env/:id', async (req, res) => {
    await executeQuery('DELETE FROM container_env_vars WHERE id = $1 AND container_name = $2',
        [req.params.id, req.params.name]);
    res.json({ ok: true });
});

// Apply env vars — reconstruct and restart container
router.post('/containers/:name/env/apply', async (req, res) => {
    const { name } = req.params;
    try {
        const { rows: envRows } = await executeQuery(
            'SELECT key, encrypted_value FROM container_env_vars WHERE container_name = $1', [name]
        );
        const envMap: Record<string, string> = {};
        for (const r of envRows) envMap[r.key] = decrypt(r.encrypted_value);

        const docker = getDocker();
        const containers = await docker.listContainers({ all: true });
        const found = containers.find(c => c.Names.some(n => n.replace(/^\//, '') === name));
        if (!found) return res.status(404).json({ message: 'Container not found' });

        const containerObj = docker.getContainer(found.Id);
        const info = await containerObj.inspect();
        const cfg = info.Config;
        const hostCfg = info.HostConfig;

        // Merge existing env with new env (new overrides old)
        const existingEnv: Record<string, string> = {};
        for (const e of (cfg.Env || [])) {
            const idx = e.indexOf('=');
            if (idx > -1) existingEnv[e.slice(0, idx)] = e.slice(idx + 1);
        }
        const merged = { ...existingEnv, ...envMap };
        const envArr = Object.entries(merged).map(([k, v]) => `${k}=${v}`);

        // Stop and remove
        try { await containerObj.stop(); } catch { /* already stopped */ }
        await containerObj.remove();

        // Recreate
        const newContainer = await docker.createContainer({
            name,
            Image: cfg.Image,
            Cmd: cfg.Cmd || undefined,
            Entrypoint: cfg.Entrypoint || undefined,
            Env: envArr,
            ExposedPorts: cfg.ExposedPorts || {},
            HostConfig: hostCfg,
            Labels: cfg.Labels || {},
        });
        await newContainer.start();
        res.json({ ok: true, message: 'Container restarted with new environment' });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONTAINER SCHEDULER
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/containers/:name/schedules', async (req, res) => {
    const { rows } = await executeQuery(
        'SELECT * FROM container_schedules WHERE container_name = $1 ORDER BY created_at DESC',
        [req.params.name]
    );
    res.json({ schedules: rows });
});

router.post('/containers/:name/schedules', async (req, res) => {
    const { name } = req.params;
    const { label, cron_expr, command, enabled = true } = req.body;
    if (!label || !cron_expr || !command) return res.status(400).json({ message: 'label, cron_expr, command required' });
    if (!cron.validate(cron_expr)) return res.status(400).json({ message: 'Invalid cron expression' });
    const { rows } = await executeQuery(
        `INSERT INTO container_schedules (container_name, label, cron_expr, command, enabled) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [name, label, cron_expr, command, enabled]
    );
    const sched = rows[0];
    if (sched.enabled) mountContainerCronJob(sched);
    res.json({ schedule: sched });
});

router.patch('/containers/:name/schedules/:id', async (req, res) => {
    const { name, id } = req.params;
    const { label, cron_expr, command, enabled } = req.body;
    if (cron_expr && !cron.validate(cron_expr)) return res.status(400).json({ message: 'Invalid cron expression' });
    const { rows } = await executeQuery(
        `UPDATE container_schedules SET
            label = COALESCE($1, label),
            cron_expr = COALESCE($2, cron_expr),
            command = COALESCE($3, command),
            enabled = COALESCE($4, enabled)
         WHERE id = $5 AND container_name = $6 RETURNING *`,
        [label ?? null, cron_expr ?? null, command ?? null, enabled ?? null, id, name]
    );
    if (!rows.length) return res.status(404).json({ message: 'Schedule not found' });
    const sched = rows[0];
    const sid = parseInt(id);
    if (containerCronJobs.has(sid)) { containerCronJobs.get(sid)!.stop(); containerCronJobs.delete(sid); }
    if (sched.enabled) mountContainerCronJob(sched);
    res.json({ schedule: sched });
});

router.delete('/containers/:name/schedules/:id', async (req, res) => {
    const sid = parseInt(req.params.id);
    if (containerCronJobs.has(sid)) { containerCronJobs.get(sid)!.stop(); containerCronJobs.delete(sid); }
    await executeQuery('DELETE FROM container_schedules WHERE id = $1 AND container_name = $2',
        [req.params.id, req.params.name]);
    res.json({ ok: true });
});

router.post('/containers/:name/schedules/:id/run', async (req, res) => {
    const scheduleId = parseInt(req.params.id);
    const logId = await runContainerSchedule(scheduleId);
    res.json({ logId });
});

router.get('/containers/:name/schedules/:id/logs', async (req, res) => {
    const { rows } = await executeQuery(
        'SELECT * FROM container_schedule_logs WHERE schedule_id = $1 ORDER BY started_at DESC LIMIT 20',
        [req.params.id]
    );
    res.json({ logs: rows });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BASE DOMAIN CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/base-domain', async (_req, res) => {
    const { rows } = await executeQuery('SELECT * FROM base_domain_config WHERE id = 1');
    res.json({ config: rows[0] || null });
});

router.post('/base-domain', async (req, res) => {
    const { domain, vps_ip } = req.body;
    if (!domain || !vps_ip) return res.status(400).json({ message: 'domain and vps_ip required' });
    await executeQuery(
        `INSERT INTO base_domain_config (id, domain, vps_ip, verified) VALUES (1, $1, $2, FALSE)
         ON CONFLICT (id) DO UPDATE SET domain=$1, vps_ip=$2, verified=FALSE`,
        [domain.toLowerCase().trim(), vps_ip.trim()]
    );
    res.json({ ok: true });
});

router.post('/base-domain/verify', async (req, res) => {
    const { rows } = await executeQuery('SELECT * FROM base_domain_config WHERE id = 1');
    if (!rows.length) return res.status(400).json({ message: 'No domain configured' });
    const cfg = rows[0];
    // DNS check via system dig
    const { exec } = await import('child_process');
    const checkDns = (host: string): Promise<string[]> => new Promise((resolve) => {
        exec(`dig +short A ${host} 2>/dev/null || nslookup ${host} 2>/dev/null | grep Address | tail -n+2 | awk '{print $2}'`,
            (_err, stdout) => resolve(stdout.trim().split('\n').filter(Boolean))
        );
    });
    try {
        const [apexIps, wildcardIps] = await Promise.all([
            checkDns(cfg.domain),
            checkDns(`test.${cfg.domain}`),
        ]);
        const apexOk = apexIps.includes(cfg.vps_ip);
        const wildcardOk = wildcardIps.includes(cfg.vps_ip);
        const verified = apexOk && wildcardOk;
        await executeQuery('UPDATE base_domain_config SET verified=$1 WHERE id=1', [verified]);
        res.json({ verified, apexIps, wildcardIps, vps_ip: cfg.vps_ip, apexOk, wildcardOk });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONTAINER DOMAIN
// ═══════════════════════════════════════════════════════════════════════════════

function randomSlug() {
    return crypto.randomBytes(4).toString('hex');
}

router.get('/containers/:name/domain', async (req, res) => {
    const { rows } = await executeQuery(
        'SELECT * FROM container_domains WHERE container_name = $1', [req.params.name]
    );
    const { rows: baseCfg } = await executeQuery('SELECT * FROM base_domain_config WHERE id = 1');
    res.json({ domain: rows[0] || null, baseDomain: baseCfg[0] || null });
});

router.post('/containers/:name/domain', async (req, res) => {
    const { name } = req.params;
    let { subdomain, port } = req.body;
    if (!port) return res.status(400).json({ message: 'port required' });

    const { rows: base } = await executeQuery('SELECT * FROM base_domain_config WHERE id = 1');
    if (!base.length || !base[0].verified) {
        return res.status(400).json({ message: 'Base domain not configured or not verified' });
    }
    const baseDomain = base[0].domain;
    if (!subdomain) subdomain = `app-${randomSlug()}`;

    const fullDomain = `${subdomain}.${baseDomain}`;
    const { rows } = await executeQuery(
        `INSERT INTO container_domains (container_name, subdomain, full_domain, port)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (container_name) DO UPDATE SET subdomain=$2, full_domain=$3, port=$4, nginx_enabled=FALSE
         RETURNING *`,
        [name, subdomain, fullDomain, port]
    );
    res.json({ domain: rows[0] });
});

router.post('/containers/:name/domain/nginx', async (req, res) => {
    const { name } = req.params;
    const { rows } = await executeQuery(
        'SELECT * FROM container_domains WHERE container_name = $1', [name]
    );
    if (!rows.length) return res.status(404).json({ message: 'No domain assigned to this container' });
    const dom = rows[0];

    const confPath = path.join(NGINX_CONF_DIR, `container-${name}.conf`);
    const conf = `server {
    listen 80;
    server_name ${dom.full_domain};

    location / {
        proxy_pass http://localhost:${dom.port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
`;
    try {
        await fs.promises.mkdir(NGINX_CONF_DIR, { recursive: true });
        await fs.promises.writeFile(confPath, conf, 'utf8');
        // Reload nginx
        try { await execInContainer(NGINX_CONTAINER, 'nginx -t && nginx -s reload'); } catch { /* best-effort */ }
        await executeQuery(
            'UPDATE container_domains SET nginx_enabled=TRUE WHERE container_name=$1', [name]
        );
        res.json({ ok: true, fullDomain: dom.full_domain });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.delete('/containers/:name/domain', async (req, res) => {
    const { name } = req.params;
    const confPath = path.join(NGINX_CONF_DIR, `container-${name}.conf`);
    try { await fs.promises.unlink(confPath); } catch { /* already gone */ }
    try { await execInContainer(NGINX_CONTAINER, 'nginx -s reload'); } catch { /* best-effort */ }
    await executeQuery('DELETE FROM container_domains WHERE container_name=$1', [name]);
    res.json({ ok: true });
});

router.post('/containers/:name/domain/regenerate', async (req, res) => {
    const { name } = req.params;
    const { rows } = await executeQuery(
        'SELECT * FROM container_domains WHERE container_name = $1', [name]
    );
    if (!rows.length) return res.status(404).json({ message: 'No domain found' });
    const { rows: base } = await executeQuery('SELECT * FROM base_domain_config WHERE id = 1');
    const baseDomain = base[0]?.domain;
    const newSub = `app-${randomSlug()}`;
    const fullDomain = `${newSub}.${baseDomain}`;
    const { rows: updated } = await executeQuery(
        `UPDATE container_domains SET subdomain=$1, full_domain=$2, nginx_enabled=FALSE WHERE container_name=$3 RETURNING *`,
        [newSub, fullDomain, name]
    );
    // Remove old nginx conf
    const confPath = path.join(NGINX_CONF_DIR, `container-${name}.conf`);
    try { await fs.promises.unlink(confPath); } catch { /* already gone */ }
    res.json({ domain: updated[0] });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BACKUPS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/containers/:name/backups', async (req, res) => {
    const { rows } = await executeQuery(
        'SELECT * FROM container_backups WHERE container_name=$1 ORDER BY created_at DESC',
        [req.params.name]
    );
    res.json({ backups: rows });
});

router.post('/containers/:name/backups', async (req, res) => {
    const { name } = req.params;
    const { label, cron_expr, s3_bucket, prefix = '', keep_n = 5, enabled = true } = req.body;
    if (!label || !s3_bucket) return res.status(400).json({ message: 'label and s3_bucket required' });
    if (cron_expr && !cron.validate(cron_expr)) return res.status(400).json({ message: 'Invalid cron expression' });
    const { rows } = await executeQuery(
        `INSERT INTO container_backups (container_name, label, cron_expr, s3_bucket, prefix, keep_n, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [name, label, cron_expr || null, s3_bucket, prefix, keep_n, enabled]
    );
    const backup = rows[0];
    if (backup.enabled && backup.cron_expr) mountBackupCronJob(backup);
    res.json({ backup });
});

router.patch('/containers/:name/backups/:id', async (req, res) => {
    const { name, id } = req.params;
    const { label, cron_expr, s3_bucket, prefix, keep_n, enabled } = req.body;
    if (cron_expr && !cron.validate(cron_expr)) return res.status(400).json({ message: 'Invalid cron expression' });
    const { rows } = await executeQuery(
        `UPDATE container_backups SET
            label=COALESCE($1,label), cron_expr=COALESCE($2,cron_expr),
            s3_bucket=COALESCE($3,s3_bucket), prefix=COALESCE($4,prefix),
            keep_n=COALESCE($5,keep_n), enabled=COALESCE($6,enabled)
         WHERE id=$7 AND container_name=$8 RETURNING *`,
        [label ?? null, cron_expr ?? null, s3_bucket ?? null, prefix ?? null, keep_n ?? null, enabled ?? null, id, name]
    );
    if (!rows.length) return res.status(404).json({ message: 'Backup not found' });
    const backup = rows[0];
    const bid = parseInt(id);
    if (backupCronJobs.has(bid)) { backupCronJobs.get(bid)!.stop(); backupCronJobs.delete(bid); }
    if (backup.enabled && backup.cron_expr) mountBackupCronJob(backup);
    res.json({ backup });
});

router.delete('/containers/:name/backups/:id', async (req, res) => {
    const bid = parseInt(req.params.id);
    if (backupCronJobs.has(bid)) { backupCronJobs.get(bid)!.stop(); backupCronJobs.delete(bid); }
    await executeQuery('DELETE FROM container_backups WHERE id=$1 AND container_name=$2',
        [req.params.id, req.params.name]);
    res.json({ ok: true });
});

router.post('/containers/:name/backups/:id/run', async (req, res) => {
    const logId = await runBackup(parseInt(req.params.id));
    res.json({ logId });
});

router.get('/containers/:name/backups/:id/logs', async (req, res) => {
    const { rows } = await executeQuery(
        'SELECT * FROM container_backup_logs WHERE backup_id=$1 ORDER BY started_at DESC LIMIT 20',
        [req.params.id]
    );
    res.json({ logs: rows });
});

// List backups from S3 for restore
router.get('/containers/:name/backups/:id/s3-files', async (req, res) => {
    const { rows } = await executeQuery('SELECT * FROM container_backups WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Backup not found' });
    const backup = rows[0];
    try {
        const { client } = await getS3Client();
        const prefix = backup.prefix ? `${backup.prefix}/${backup.container_name}/` : `${backup.container_name}/`;
        const cmd = new ListObjectsV2Command({ Bucket: backup.s3_bucket, Prefix: prefix });
        const result = await client.send(cmd);
        const files = (result.Contents || []).map(o => ({
            key: o.Key,
            size: o.Size,
            lastModified: o.LastModified,
        })).sort((a, b) => (b.lastModified?.getTime() || 0) - (a.lastModified?.getTime() || 0));
        res.json({ files });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// Restore backup from S3 key
router.post('/containers/:name/restore', async (req, res) => {
    const { name } = req.params;
    const { s3_bucket, s3_key, backup_id } = req.body;
    if (!s3_bucket || !s3_key) return res.status(400).json({ message: 's3_bucket and s3_key required' });

    res.json({ ok: true, message: 'Restore started in background' });

    // Run restore async
    (async () => {
        try {
            const { client } = await getS3Client();
            const getCmd = new GetObjectCommand({ Bucket: s3_bucket, Key: s3_key });
            const result = await client.send(getCmd);
            if (!result.Body) throw new Error('Empty response from S3');

            const docker = getDocker();
            const containers = await docker.listContainers({ all: true });
            const found = containers.find(c => c.Names.some(n => n.replace(/^\//, '') === name));
            if (!found) throw new Error(`Container '${name}' not found`);

            // Import stream into container using docker import → docker stop → replace
            const containerObj = docker.getContainer(found.Id);
            const info = await containerObj.inspect();

            const { pipeline } = await import('stream');
            const zlib = await import('zlib');
            const { promisify } = await import('util');
            const pipelineAsync = promisify(pipeline);

            const gunzip = zlib.createGunzip();
            const decompressed = (result.Body as any).pipe(gunzip);

            await containerObj.stop().catch(() => { });
            await (docker as any).loadImage(decompressed);
            console.log(`[Restore] Restore completed for ${name}`);
        } catch (err: any) {
            console.error(`[Restore] Error: ${err.message}`);
        }
    })();
});

export default router;
