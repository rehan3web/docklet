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

// ── Server-IP detection ───────────────────────────────────────────────────────
let _cachedIp: string | null = null;
async function getServerIp(): Promise<string> {
    if (process.env.SERVER_IP) return process.env.SERVER_IP;
    if (_cachedIp) return _cachedIp;
    try {
        const r = await fetch('https://api.ipify.org?format=json');
        _cachedIp = ((await r.json()) as any).ip;
        return _cachedIp!;
    } catch {
        return '127.0.0.1';
    }
}
getServerIp().catch(() => {});

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
        CREATE TABLE IF NOT EXISTS container_env_versions (
            id SERIAL PRIMARY KEY,
            container_name TEXT NOT NULL,
            version INTEGER NOT NULL,
            snapshot JSONB NOT NULL,
            applied_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())*1000
        )`);
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS container_schedules (
            id SERIAL PRIMARY KEY,
            container_name TEXT NOT NULL,
            label TEXT NOT NULL,
            cron_expr TEXT NOT NULL,
            command TEXT NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            is_running BOOLEAN NOT NULL DEFAULT FALSE,
            timeout_secs INTEGER NOT NULL DEFAULT 0,
            max_retries INTEGER NOT NULL DEFAULT 0,
            last_run BIGINT,
            created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())*1000
        )`);
    // Add new columns to existing schedule table if they don't exist
    await executeQuery(`ALTER TABLE container_schedules ADD COLUMN IF NOT EXISTS is_running BOOLEAN NOT NULL DEFAULT FALSE`);
    await executeQuery(`ALTER TABLE container_schedules ADD COLUMN IF NOT EXISTS timeout_secs INTEGER NOT NULL DEFAULT 0`);
    await executeQuery(`ALTER TABLE container_schedules ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 0`);
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS container_schedule_logs (
            id SERIAL PRIMARY KEY,
            schedule_id INTEGER NOT NULL REFERENCES container_schedules(id) ON DELETE CASCADE,
            started_at BIGINT NOT NULL,
            finished_at BIGINT,
            status TEXT NOT NULL DEFAULT 'running',
            output TEXT NOT NULL DEFAULT '',
            retry_count INTEGER NOT NULL DEFAULT 0
        )`);
    await executeQuery(`ALTER TABLE container_schedule_logs ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0`);
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
            traefik_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            routing_mode TEXT NOT NULL DEFAULT 'nginx',
            created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())*1000
        )`);
    // Add new columns to existing domains table
    await executeQuery(`ALTER TABLE container_domains ADD COLUMN IF NOT EXISTS traefik_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
    await executeQuery(`ALTER TABLE container_domains ADD COLUMN IF NOT EXISTS routing_mode TEXT NOT NULL DEFAULT 'nginx'`);
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

async function execWithTimeout(containerName: string, cmd: string, timeoutSecs: number): Promise<string> {
    if (timeoutSecs <= 0) return execInContainer(containerName, cmd);
    return Promise.race([
        execInContainer(containerName, cmd),
        new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error(`Timed out after ${timeoutSecs}s`)), timeoutSecs * 1000)
        ),
    ]);
}

async function runContainerSchedule(scheduleId: number): Promise<number> {
    const { rows } = await executeQuery(
        'SELECT * FROM container_schedules WHERE id = $1', [scheduleId]
    );
    if (!rows.length) return -1;
    const sched = rows[0];

    // ── Overlap prevention ─────────────────────────────────────────────────────
    if (sched.is_running) {
        console.log(`[Scheduler] Skipping schedule ${scheduleId} — already running`);
        return -1;
    }

    await executeQuery('UPDATE container_schedules SET is_running=TRUE WHERE id=$1', [scheduleId]);

    const { rows: logRows } = await executeQuery(
        `INSERT INTO container_schedule_logs (schedule_id, started_at, status) VALUES ($1, $2, 'running') RETURNING id`,
        [scheduleId, Date.now()]
    );
    const logId = logRows[0].id;

    let output = '';
    let status = 'success';
    const maxRetries = sched.max_retries ?? 0;
    let retryCount = 0;

    // ── Retry loop ─────────────────────────────────────────────────────────────
    while (retryCount <= maxRetries) {
        try {
            output = await execWithTimeout(sched.container_name, sched.command, sched.timeout_secs ?? 0);
            status = 'success';
            break;
        } catch (err: any) {
            output = err.message || String(err);
            status = 'error';
            if (retryCount < maxRetries) {
                output += `\n[Retry ${retryCount + 1}/${maxRetries}]`;
                retryCount++;
                await new Promise(r => setTimeout(r, 2000 * retryCount)); // exponential back-off
            } else break;
        }
    }

    const now = Date.now();
    await executeQuery(
        `UPDATE container_schedules SET last_run=$1, is_running=FALSE WHERE id=$2`,
        [now, scheduleId]
    );
    await executeQuery(
        `UPDATE container_schedule_logs SET finished_at=$1, status=$2, output=$3, retry_count=$4 WHERE id=$5`,
        [now, status, output, retryCount, logId]
    );
    return logId;
}

// ── DB-type detection ─────────────────────────────────────────────────────────
type DbType = 'postgres' | 'mysql' | 'mariadb' | 'mongo' | null;

function detectDbType(image: string): DbType {
    const img = image.toLowerCase();
    if (img.includes('postgres') || img.includes('postgre')) return 'postgres';
    if (img.includes('mariadb')) return 'mariadb';
    if (img.includes('mysql')) return 'mysql';
    if (img.includes('mongo')) return 'mongo';
    return null;
}

async function getContainerDbType(name: string): Promise<{ dbType: DbType; id: string } | null> {
    const docker = getDocker();
    const containers = await docker.listContainers({ all: true });
    const found = containers.find(c => c.Names.some(n => n.replace(/^\//, '') === name));
    if (!found) return null;
    return { dbType: detectDbType(found.Image), id: found.Id };
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

    try {
        await appendLog(`[${new Date().toUTCString()}] Starting backup process...`);

        // Resolve container and detect DB type
        const docker = getDocker();
        const containers = await docker.listContainers({ all: true });
        const found = containers.find(c =>
            c.Names.some(n => n.replace(/^\//, '') === backup.container_name)
        );
        if (!found) throw new Error(`Container '${backup.container_name}' not found`);
        const dbType = detectDbType(found.Image);
        if (!dbType) throw new Error(`Container '${backup.container_name}' is not a database container (image: ${found.Image}). Only PostgreSQL, MySQL, MariaDB, and MongoDB containers can be backed up.`);

        await appendLog(`[${new Date().toUTCString()}] Detected DB type: ${dbType} (${found.Id.slice(0, 12)})`);

        // Build dump command
        let dumpArgs: string[];
        let ext: string;
        if (dbType === 'postgres') {
            dumpArgs = ['exec', found.Id, 'pg_dump', '-U', 'postgres', '--format=custom', '--no-password'];
            ext = 'pgdump';
        } else if (dbType === 'mysql') {
            dumpArgs = ['exec', found.Id, 'mysqldump', '-u', 'root', '--all-databases', '--single-transaction', '--quick'];
            ext = 'sql';
        } else if (dbType === 'mariadb') {
            dumpArgs = ['exec', found.Id, 'mariadb-dump', '-u', 'root', '--all-databases', '--single-transaction', '--quick'];
            ext = 'sql';
        } else {
            dumpArgs = ['exec', found.Id, 'mongodump', '--archive'];
            ext = 'archive';
        }

        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const prefix = backup.prefix ? `${backup.prefix}/` : '';
        const s3Key = `${prefix}${backup.container_name}/${ts}.${ext}.gz`;

        await appendLog(`[${new Date().toUTCString()}] Running dump command...`);

        const { client } = await getS3Client();
        const zlib = await import('zlib');

        await new Promise<void>((resolve, reject) => {
            const child = spawn('docker', dumpArgs);
            const gzip = zlib.createGzip();
            child.stdout.pipe(gzip);

            const upload = new Upload({
                client,
                params: {
                    Bucket: backup.s3_bucket,
                    Key: s3Key,
                    Body: gzip,
                    ContentType: 'application/gzip',
                },
            });

            const stderrBuf: string[] = [];
            child.stderr.on('data', (d: Buffer) => stderrBuf.push(d.toString()));
            child.on('error', reject);
            child.on('close', async (code: number) => {
                if (code !== 0) {
                    reject(new Error(`Dump process exited with code ${code}: ${stderrBuf.join('').slice(0, 300)}`));
                } else {
                    try { await upload.done(); resolve(); }
                    catch (e) { reject(e); }
                }
            });
        });

        await appendLog(`[${new Date().toUTCString()}] ✅ Dump completed and uploaded to S3`);
        await appendLog(`[${new Date().toUTCString()}] S3 key: ${s3Key}`);
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

// ── Env version history ────────────────────────────────────────────────────────
router.get('/containers/:name/env/versions', async (req, res) => {
    const { rows } = await executeQuery(
        `SELECT id, version, applied_at FROM container_env_versions WHERE container_name=$1 ORDER BY version DESC LIMIT 20`,
        [req.params.name]
    );
    res.json({ versions: rows });
});

router.get('/containers/:name/env/versions/:version', async (req, res) => {
    const { rows } = await executeQuery(
        `SELECT * FROM container_env_versions WHERE container_name=$1 AND version=$2`,
        [req.params.name, req.params.version]
    );
    if (!rows.length) return res.status(404).json({ message: 'Version not found' });
    // Return keys only (not encrypted values) for display
    const snapshot = rows[0].snapshot as Record<string, string>;
    res.json({ version: rows[0].version, applied_at: rows[0].applied_at, keys: Object.keys(snapshot) });
});

router.post('/containers/:name/env/rollback/:version', async (req, res) => {
    const { name, version } = req.params;
    try {
        const { rows } = await executeQuery(
            `SELECT * FROM container_env_versions WHERE container_name=$1 AND version=$2`, [name, version]
        );
        if (!rows.length) return res.status(404).json({ message: 'Version not found' });
        const snapshot = rows[0].snapshot as Record<string, string>;
        // Clear current env vars
        await executeQuery('DELETE FROM container_env_vars WHERE container_name=$1', [name]);
        // Restore snapshot
        for (const [key, encValue] of Object.entries(snapshot)) {
            await executeQuery(
                `INSERT INTO container_env_vars (container_name, key, encrypted_value) VALUES ($1, $2, $3)`,
                [name, key, encValue]
            );
        }
        res.json({ ok: true, message: `Rolled back to version ${version}` });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
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

        // ── Snapshot current env vars as a new version ─────────────────────────
        const { rows: verRows } = await executeQuery(
            `SELECT COALESCE(MAX(version), 0) AS max_ver FROM container_env_versions WHERE container_name=$1`, [name]
        );
        const nextVersion = (verRows[0]?.max_ver ?? 0) + 1;
        const snapshot: Record<string, string> = {};
        for (const r of envRows) snapshot[r.key] = r.encrypted_value;
        await executeQuery(
            `INSERT INTO container_env_versions (container_name, version, snapshot) VALUES ($1, $2, $3)`,
            [name, nextVersion, JSON.stringify(snapshot)]
        );

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

        // Respond BEFORE touching the container — the container being recreated
        // may be serving the UI/proxy (e.g. docklet-client), so stopping it mid-
        // request would drop the connection and surface ERR_EMPTY_RESPONSE.
        res.json({ ok: true, message: 'Container restarting with new environment…' });

        // ── Background recreation (response already sent) ──────────────────────
        setImmediate(async () => {
            try {
                // Stop (5s grace), force-remove, brief pause, recreate
                try { await containerObj.stop({ t: 5 } as any); } catch { /* already stopped */ }
                try { await containerObj.remove({ force: true } as any); } catch { /* best-effort */ }
                await new Promise(r => setTimeout(r, 800));

                const newContainer = await docker.createContainer({
                    name,
                    Image: cfg.Image,
                    Cmd: cfg.Cmd?.length ? cfg.Cmd : undefined,
                    Entrypoint: cfg.Entrypoint?.length ? cfg.Entrypoint : undefined,
                    Env: envArr,
                    ExposedPorts: cfg.ExposedPorts || {},
                    WorkingDir: cfg.WorkingDir || undefined,
                    User: cfg.User || undefined,
                    HostConfig: sanitiseHostConfig(hostCfg),
                    Labels: cfg.Labels || {},
                });
                await newContainer.start();
                console.log(`[EnvApply] Container "${name}" restarted with new env (version ${nextVersion}).`);
            } catch (bgErr: any) {
                console.error(`[EnvApply] Background recreation failed for "${name}":`, bgErr.message);
            }
        });
    } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ message: err.message });
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
    const { label, cron_expr, command, enabled = true, timeout_secs = 0, max_retries = 0 } = req.body;
    if (!label || !cron_expr || !command) return res.status(400).json({ message: 'label, cron_expr, command required' });
    if (!cron.validate(cron_expr)) return res.status(400).json({ message: 'Invalid cron expression' });
    const { rows } = await executeQuery(
        `INSERT INTO container_schedules (container_name, label, cron_expr, command, enabled, timeout_secs, max_retries)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [name, label, cron_expr, command, enabled, timeout_secs, max_retries]
    );
    const sched = rows[0];
    if (sched.enabled) mountContainerCronJob(sched);
    res.json({ schedule: sched });
});

router.patch('/containers/:name/schedules/:id', async (req, res) => {
    const { name, id } = req.params;
    const { label, cron_expr, command, enabled, timeout_secs, max_retries } = req.body;
    if (cron_expr && !cron.validate(cron_expr)) return res.status(400).json({ message: 'Invalid cron expression' });
    const { rows } = await executeQuery(
        `UPDATE container_schedules SET
            label = COALESCE($1, label),
            cron_expr = COALESCE($2, cron_expr),
            command = COALESCE($3, command),
            enabled = COALESCE($4, enabled),
            timeout_secs = COALESCE($5, timeout_secs),
            max_retries = COALESCE($6, max_retries)
         WHERE id = $7 AND container_name = $8 RETURNING *`,
        [label ?? null, cron_expr ?? null, command ?? null, enabled ?? null,
         timeout_secs ?? null, max_retries ?? null, id, name]
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
    const serverIp = await getServerIp();

    const confPath = path.join(NGINX_CONF_DIR, `container-${name}.conf`);
    const conf = `server {
    listen 80;
    server_name ${dom.full_domain};

    location / {
        proxy_pass http://${serverIp}:${dom.port};
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

// ── Traefik integration ────────────────────────────────────────────────────────
// Sanitise HostConfig from docker inspect before passing to createContainer.
// The raw inspect result contains read-only / runtime-computed fields that the
// Docker API rejects, and AutoRemove:true would immediately delete our new container.
function sanitiseHostConfig(raw: any): any {
    const safe: any = {};
    const pick = [
        'Binds', 'PortBindings', 'NetworkMode', 'RestartPolicy',
        'Privileged', 'CapAdd', 'CapDrop', 'Devices', 'DeviceCgroupRules',
        'Memory', 'MemorySwap', 'NanoCpus', 'CpuShares', 'CpusetCpus',
        'PidMode', 'IpcMode', 'UTSMode', 'UsernsMode',
        'ShmSize', 'Sysctls', 'ExtraHosts', 'Ulimits', 'GroupAdd',
        'SecurityOpt', 'ReadonlyRootfs', 'Tmpfs', 'Isolation',
        'LogConfig', 'VolumeDriver', 'VolumesFrom', 'Links',
    ];
    for (const key of pick) {
        if (raw[key] !== undefined && raw[key] !== null) safe[key] = raw[key];
    }
    safe.AutoRemove = false; // CRITICAL: never auto-remove our recreated container
    return safe;
}

router.post('/containers/:name/domain/traefik', async (req, res) => {
    const { name } = req.params;
    try {
        const { rows } = await executeQuery('SELECT * FROM container_domains WHERE container_name=$1', [name]);
        if (!rows.length) return res.status(404).json({ message: 'No domain assigned to this container' });
        const dom = rows[0];

        const docker = getDocker();
        const containers = await docker.listContainers({ all: true });
        const found = containers.find(c => c.Names.some(n => n.replace(/^\//, '') === name));
        if (!found) return res.status(404).json({ message: 'Container not found in Docker' });

        const containerObj = docker.getContainer(found.Id);
        const info = await containerObj.inspect();

        // Build Traefik labels (merge into existing, don't clobber compose labels)
        const safeName = name.replace(/[^a-zA-Z0-9]/g, '-');
        const traefikLabels: Record<string, string> = {
            'traefik.enable': 'true',
            [`traefik.http.routers.${safeName}.rule`]: `Host(\`${dom.full_domain}\`)`,
            [`traefik.http.routers.${safeName}.entrypoints`]: 'web,websecure',
            [`traefik.http.routers.${safeName}.tls.certresolver`]: 'letsencrypt',
            [`traefik.http.services.${safeName}.loadbalancer.server.port`]: String(dom.port),
        };
        const mergedLabels = { ...(info.Config.Labels ?? {}), ...traefikLabels };

        // Update DB and respond BEFORE touching the container.
        // The container being recreated may be the one proxying this very request
        // (e.g. docklet-client / nginx frontend), so we must send the response
        // first or the connection gets dropped mid-flight.
        await executeQuery(
            `UPDATE container_domains SET nginx_enabled=FALSE, traefik_enabled=TRUE, routing_mode='traefik' WHERE container_name=$1`, [name]
        );
        res.json({ ok: true, fullDomain: dom.full_domain, labels: traefikLabels });

        // ── Background recreation (response already sent) ──────────────────────
        setImmediate(async () => {
            try {
                console.log(`[Traefik] Recreating container "${name}" with labels…`);

                // Stop with a short timeout
                try {
                    await containerObj.stop({ t: 5 } as any);
                } catch (e: any) {
                    if (!e.message?.includes('not running') && e.statusCode !== 304) {
                        console.warn(`[Traefik] stop warning: ${e.message}`);
                    }
                }

                // Force-remove
                try {
                    await containerObj.remove({ force: true } as any);
                } catch (e: any) {
                    console.warn(`[Traefik] remove warning: ${e.message}`);
                }

                // Brief pause — Docker needs a moment to release the container name
                await new Promise(r => setTimeout(r, 800));

                const newContainer = await docker.createContainer({
                    name,
                    Image: info.Config.Image,
                    Cmd: info.Config.Cmd?.length ? info.Config.Cmd : undefined,
                    Entrypoint: info.Config.Entrypoint?.length ? info.Config.Entrypoint : undefined,
                    Env: info.Config.Env || [],
                    ExposedPorts: info.Config.ExposedPorts || {},
                    WorkingDir: info.Config.WorkingDir || undefined,
                    User: info.Config.User || undefined,
                    HostConfig: sanitiseHostConfig(info.HostConfig),
                    Labels: mergedLabels,
                });
                await newContainer.start();
                console.log(`[Traefik] Container "${name}" recreated and started.`);

                // Clean up old nginx config if any
                const confPath = path.join(NGINX_CONF_DIR, `container-${name}.conf`);
                try { await fs.promises.unlink(confPath); } catch { /* not present */ }
            } catch (bgErr: any) {
                console.error(`[Traefik] Background recreation failed for "${name}":`, bgErr.message);
            }
        });
    } catch (err: any) {
        console.error(`[Traefik] Error for "${name}":`, err.message);
        if (!res.headersSent) res.status(500).json({ message: err.message });
    }
});

// ── Traefik compose snippet ────────────────────────────────────────────────────
router.get('/traefik/compose-snippet', async (req, res) => {
    const { rows } = await executeQuery('SELECT * FROM base_domain_config WHERE id=1');
    const email = (req.query.email as string) || 'admin@example.com';
    const domain = rows[0]?.domain || 'yourdomain.com';
    const snippet = `  traefik:
    image: traefik:v3.0
    container_name: docklet-traefik
    restart: unless-stopped
    command:
      - "--api.insecure=false"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
      - "--entrypoints.web.http.redirections.entrypoint.scheme=https"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencrypt.acme.email=${email}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - "/var/run/docker.sock:/var/run/docker.sock:ro"
      - "./letsencrypt:/letsencrypt"
    networks:
      - proxy

networks:
  proxy:
    external: true`;
    res.json({ snippet, domain, email });
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

// GET /containers/:name/db-type — detect if container runs a supported DB
router.get('/containers/:name/db-type', async (req, res) => {
    try {
        const result = await getContainerDbType(req.params.name);
        if (!result) return res.status(404).json({ dbType: null, message: 'Container not found' });
        res.json({ dbType: result.dbType });
    } catch (err: any) {
        res.status(500).json({ dbType: null, message: err.message });
    }
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
