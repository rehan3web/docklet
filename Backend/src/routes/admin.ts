import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { executeQuery, executeSysQuery, resetPool } from '../lib/db';
import { spawn, execSync } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { loadConfig } from '../lib/config';

const router = express.Router();

const BACKUP_DIR = path.resolve(process.cwd(), 'backups');
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function findConfigPath(): string | null {
    const candidates = [
        '/config/postgres.yml',                             // Docker container mount
        path.resolve(process.cwd(), 'postgres.yml'),
        path.resolve(process.cwd(), '../postgres.yml'),
        path.resolve(__dirname, '../../../postgres.yml'),
        path.resolve(__dirname, '../../postgres.yml'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

async function getPublicIP(): Promise<string> {
    try {
        const resp = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) });
        const data = await resp.json() as { ip: string };
        if (data?.ip) return data.ip;
    } catch { }
    // Fallback: read non-internal IPv4 from os
    try {
        const ifaces = os.networkInterfaces();
        for (const list of Object.values(ifaces)) {
            for (const iface of (list || [])) {
                if (iface.family === 'IPv4' && !iface.internal) return iface.address;
            }
        }
    } catch { }
    return '127.0.0.1';
}

function isDockerContainerRunning(name: string): boolean {
    try {
        const out = execSync(`docker inspect --format='{{.State.Running}}' ${name} 2>/dev/null`, { stdio: 'pipe', timeout: 3000 }).toString().trim();
        return out === "'true'" || out === 'true';
    } catch { return false; }
}

function isDockerAvailable(): boolean {
    try { execSync('docker ps --quiet --filter name=docklet-db 2>/dev/null', { stdio: 'pipe', timeout: 3000 }); return true; } catch { return false; }
}

const PROXY_CONTAINER = 'docklet-proxy';

function isProxyRunning(): boolean {
    return isDockerContainerRunning(PROXY_CONTAINER);
}

/** Returns ['docker','compose'] or ['docker-compose'] depending on what's installed */
function composeCmd(): string[] {
    try { execSync('docker compose version', { stdio: 'pipe', timeout: 3000 }); return ['docker', 'compose']; } catch {}
    try { execSync('docker-compose version', { stdio: 'pipe', timeout: 3000 }); return ['docker-compose']; } catch {}
    return ['docker', 'compose'];
}

function dockerComposeProxy(action: 'up' | 'stop' | 'rm'): Promise<string> {
    const cfgPath = findConfigPath();
    if (!cfgPath) return Promise.reject(new Error('postgres.yml not found'));
    const base = composeCmd();
    const fileArgs = ['-f', cfgPath];
    const actionArgs = action === 'up'
        ? ['--profile', 'expose', 'up', '-d', '--build', 'docklet-proxy']
        : action === 'stop'
        ? ['stop', 'docklet-proxy']
        : ['rm', '-f', 'docklet-proxy'];
    const [bin, ...rest] = [...base, ...fileArgs, ...actionArgs];
    return new Promise((resolve, reject) => {
        const proc = spawn(bin, rest, { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        proc.stdout!.on('data', (d: Buffer) => { out += d.toString(); });
        proc.stderr!.on('data', (d: Buffer) => { err += d.toString(); });
        proc.on('close', (code) => {
            if (code === 0) resolve(out + err);
            else reject(new Error(`docker compose exit ${code}: ${(err || out).substring(0, 500)}`));
        });
        proc.on('error', reject);
    });
}

function getDbConfig() {
    const cfg = loadConfig();
    const pgService = cfg?.services?.postgres || {};
    const bouncer = cfg?.services?.pgbouncer || {};
    const user = pgService?.environment?.POSTGRES_USER || process.env.PGUSER || 'postgres';
    const password = pgService?.environment?.POSTGRES_PASSWORD || process.env.PGPASSWORD || '';
    const db = pgService?.environment?.POSTGRES_DB || process.env.PGDATABASE || 'postgres';
    const containerName = pgService?.container_name || 'docklet-db';
    const poolerContainer = bouncer?.container_name || 'docklet-pooler';

    // Local host ports (may be shifted to avoid conflict, e.g. 15432/16543)
    const parseHostPort = (portStr: string): number => {
        const parts = portStr.split(':');
        return parseInt(parts.length >= 3 ? parts[1] : parts[0], 10);
    };
    const directLocalPort = parseHostPort(pgService?.ports?.[0] || '5432:5432');
    const poolerLocalPort = parseHostPort(bouncer?.ports?.[0] || '6543:5432');

    // Public ports come from the haproxy proxy service port bindings
    const proxyService = cfg?.services?.['docklet-proxy'] || {};
    const parsePublicPort = (portStr: string): number => {
        const parts = portStr.split(':');
        return parseInt(parts.length >= 3 ? parts[1] : parts[0], 10);
    };
    const proxyPorts: string[] = proxyService?.ports || [];
    const publicDirectPort = proxyPorts[0] ? parsePublicPort(proxyPorts[0]) : directLocalPort;
    const publicPoolerPort = proxyPorts[1] ? parsePublicPort(proxyPorts[1]) : poolerLocalPort;

    return {
        user, password, db, containerName, poolerContainer,
        directPort: directLocalPort,
        poolerPort: poolerLocalPort,
        publicDirectPort,
        publicPoolerPort,
    };
}

// ── Backup via docker exec pg_dump → fallback to direct pg_dump ────────────────
router.post('/backup', authenticateToken, async (_req, res) => {
    const ts = Date.now();
    const filename = `backup_${ts}.sql`;
    const filepath = path.join(BACKUP_DIR, filename);

    const useDocker = isDockerAvailable();

    // For docker: use postgres.yml credentials; for direct: use env vars
    const { user: cfgUser, password: cfgPassword, db: cfgDb, containerName } = getDbConfig();
    const host = process.env.PGHOST || '127.0.0.1';
    const port = process.env.PGPORT || '5432';
    const user = useDocker ? cfgUser : (process.env.PGUSER || 'postgres');
    const db = useDocker ? cfgDb : (process.env.PGDATABASE || 'postgres');
    const password = useDocker ? cfgPassword : (process.env.PGPASSWORD || '');

    let proc: ReturnType<typeof spawn>;
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    if (password) env.PGPASSWORD = password;

    if (useDocker) {
        proc = spawn('docker', [
            'exec', containerName,
            'pg_dump', '-U', user, '-d', db, '--no-password',
        ], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    } else {
        proc = spawn('pg_dump', [
            '-h', host, '-p', port, '-U', user,
            '-F', 'p', '--no-password', '-f', filepath, db,
        ], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    }

    let stderr = '';
    const chunks: Buffer[] = [];

    if (useDocker) {
        proc.stdout!.on('data', (d: Buffer) => chunks.push(d));
    }
    proc.stderr!.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
        if (code !== 0) {
            return res.status(500).json({ message: `pg_dump failed: ${stderr}` });
        }
        if (useDocker) {
            fs.writeFileSync(filepath, Buffer.concat(chunks));
        }
        const stats = fs.statSync(filepath);
        res.json({
            id: `bk_${ts}`,
            filename,
            label: 'Manual backup',
            time: new Date(ts).toISOString(),
            size: formatBytes(stats.size),
            sizeBytes: stats.size,
            method: useDocker ? 'docker-exec' : 'pg_dump',
        });
    });

    proc.on('error', (err) => {
        res.status(500).json({ message: `Backup failed: ${err.message}` });
    });
});

// ── List backups ───────────────────────────────────────────────────────────────
router.get('/backups', authenticateToken, (_req, res) => {
    try {
        if (!fs.existsSync(BACKUP_DIR)) return res.json([]);
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.endsWith('.sql'))
            .map(f => {
                const fp = path.join(BACKUP_DIR, f);
                const stats = fs.statSync(fp);
                const ts = parseInt(f.replace('backup_', '').replace('.sql', ''), 10);
                return {
                    id: `bk_${ts || stats.mtimeMs}`,
                    filename: f,
                    label: 'Manual backup',
                    time: new Date(ts || stats.mtimeMs).toISOString(),
                    size: formatBytes(stats.size),
                    sizeBytes: stats.size,
                };
            })
            .sort((a, b) => b.time.localeCompare(a.time));
        res.json(files);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// ── Download backup ───────────────────────────────────────────────────────────
router.get('/backups/:id/download', authenticateToken, (req, res) => {
    const id = String(req.params.id);
    const filename = `backup_${id.replace('bk_', '')}.sql`;
    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ message: 'Backup not found' });
    res.download(filepath, filename);
});

// ── Delete backup ─────────────────────────────────────────────────────────────
router.delete('/backups/:id', authenticateToken, (req, res) => {
    const id = String(req.params.id);
    const filename = `backup_${id.replace('bk_', '')}.sql`;
    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ message: 'Backup not found' });
    fs.unlinkSync(filepath);
    res.json({ message: 'Backup deleted' });
});

// ── Restore via docker exec psql → fallback to direct psql → fallback statement exec
router.post('/restore', authenticateToken, async (req, res) => {
    const { sql } = req.body;
    if (!sql) return res.status(400).json({ message: 'SQL content is required' });

    const { user: cfgUser, password: cfgPassword, db: cfgDb, containerName } = getDbConfig();
    const useDocker = isDockerAvailable();

    const host = process.env.PGHOST || '127.0.0.1';
    const port = process.env.PGPORT || '5432';
    const user = useDocker ? cfgUser : (process.env.PGUSER || 'postgres');
    const db = useDocker ? cfgDb : (process.env.PGDATABASE || 'postgres');
    const password = useDocker ? cfgPassword : (process.env.PGPASSWORD || '');

    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    if (password) env.PGPASSWORD = password;

    let proc: ReturnType<typeof spawn>;

    if (useDocker) {
        proc = spawn('docker', [
            'exec', '-i', containerName,
            'psql', '-U', user, '-d', db, '--no-password',
        ], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    } else {
        proc = spawn('psql', [
            '-h', host, '-p', port, '-U', user, '-d', db, '--no-password',
        ], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    }

    let stderr = '';
    let stdout = '';
    proc.stdout!.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr!.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', async (code) => {
        if (code === 0) {
            const stmtCount = sql.split(';').filter((s: string) => s.trim().length > 0).length;
            return res.json({ executed: stmtCount, errors: [], method: useDocker ? 'docker-exec' : 'psql' });
        }
        // Fallback: execute statements one by one via node-postgres
        const statements = sql.split(';').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
        let executed = 0;
        const errors: string[] = [];
        for (const stmt of statements) {
            try { await executeQuery(stmt); executed++; } catch (e: any) { errors.push(e.message || String(e)); }
        }
        res.json({ executed, errors, method: 'fallback-node' });
    });

    proc.on('error', async () => {
        const statements = sql.split(';').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
        let executed = 0;
        const errors: string[] = [];
        for (const stmt of statements) {
            try { await executeQuery(stmt); executed++; } catch (e: any) { errors.push(e.message || String(e)); }
        }
        res.json({ executed, errors, method: 'fallback-node' });
    });

    proc.stdin!.write(sql);
    proc.stdin!.end();
});

// ── Connection config from postgres.yml ───────────────────────────────────────
router.get('/connection', authenticateToken, async (_req, res) => {
    const { user, password, db, containerName, poolerContainer, directPort, poolerPort, publicDirectPort, publicPoolerPort } = getDbConfig();
    const publicIp = await getPublicIP();
    const exposed = isProxyRunning();

    const encUser = encodeURIComponent(user);
    const encPass = encodeURIComponent(password);
    const dockerRunning = isDockerContainerRunning(containerName);

    res.json({
        user, db, containerName, poolerContainer,
        directPort, poolerPort,
        publicDirectPort, publicPoolerPort,
        serverIp: publicIp,
        dockerRunning,
        directLocal:  `postgresql://${encUser}:${encPass}@127.0.0.1:${directPort}/${db}`,
        poolerLocal:  `postgresql://${encUser}:${encPass}@127.0.0.1:${poolerPort}/${db}`,
        directPublic: `postgresql://${encUser}:${encPass}@${publicIp}:${publicDirectPort}/${db}`,
        poolerPublic: `postgresql://${encUser}:${encPass}@${publicIp}:${publicPoolerPort}/${db}`,
        exposed,
    });
});

// ── Expose Public — builds & starts the HAProxy container ────────────────────
router.post('/expose', authenticateToken, async (_req, res) => {
    try {
        const { user, password, db, publicDirectPort, publicPoolerPort } = getDbConfig();
        const publicIp = await getPublicIP();
        const encUser = encodeURIComponent(user);
        const encPass = encodeURIComponent(password);

        if (!isDockerAvailable()) {
            return res.status(500).json({ message: 'Docker is not running on this machine.' });
        }

        if (!isProxyRunning()) {
            try {
                await dockerComposeProxy('up');
            } catch (e: any) {
                return res.status(500).json({ message: `Could not start HAProxy proxy: ${e.message}` });
            }
        }

        res.json({
            exposed: true,
            mode: 'haproxy',
            serverIp: publicIp,
            directPublicPort: publicDirectPort,
            poolerPublicPort: publicPoolerPort,
            directPublic: `postgresql://${encUser}:${encPass}@${publicIp}:${publicDirectPort}/${db}`,
            poolerPublic: `postgresql://${encUser}:${encPass}@${publicIp}:${publicPoolerPort}/${db}`,
        });
    } catch (err: any) {
        res.status(500).json({ message: `Failed to expose: ${err.message}` });
    }
});

// ── Remove Public — stops & removes the HAProxy container ────────────────────
router.post('/unexpose', authenticateToken, async (_req, res) => {
    try { await dockerComposeProxy('stop'); } catch { /* not running */ }
    try { await dockerComposeProxy('rm'); } catch { /* not running */ }
    res.json({ exposed: false, note: 'HAProxy TCP proxy stopped. Database is local-only.' });
});

/**
 * Run a SQL command inside the PostgreSQL container via docker exec + psql.
 * Connects to template1 (always exists) using the Unix socket inside the
 * container — completely bypasses pgBouncer and any network restrictions.
 */
function dockerPsql(containerName: string, pgUser: string, sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
        // Connect to template1 so we are NOT connected to the target database
        const proc = spawn('docker', [
            'exec', containerName,
            'psql', '-U', pgUser, '-d', 'template1', '-c', sql,
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        proc.stdout!.on('data', (d: Buffer) => { out += d.toString(); });
        proc.stderr!.on('data', (d: Buffer) => { err += d.toString(); });
        proc.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error((err || out).trim() || `psql exited with code ${code}`));
        });
        proc.on('error', reject);
    });
}

/** docker stop <container> — ignores errors if already stopped */
function dockerStop(container: string): Promise<void> {
    return new Promise(resolve => {
        const proc = spawn('docker', ['stop', container], { stdio: 'ignore' });
        proc.on('close', () => resolve());
        proc.on('error', () => resolve());
    });
}

/** docker start <container> — ignores errors if already running */
function dockerStart(container: string): Promise<void> {
    return new Promise(resolve => {
        const proc = spawn('docker', ['start', container], { stdio: 'ignore' });
        proc.on('close', () => resolve());
        proc.on('error', () => resolve());
    });
}

// ── Pause database ────────────────────────────────────────────────────────────
router.post('/db/pause', authenticateToken, async (_req, res) => {
    try {
        // Get db name from config — no live connection needed
        const { containerName, poolerContainer, user, db: dbName } = getDbConfig();

        // 1. Block new direct Postgres connections (runs inside container via Unix socket)
        await dockerPsql(containerName, user, `ALTER DATABASE "${dbName}" WITH ALLOW_CONNECTIONS false`);

        // 2. Stop pgBouncer so its cached server-pool cannot serve external clients
        await dockerStop(poolerContainer);

        // 3. Terminate remaining direct connections (excludes Docklet's own pool)
        try {
            await executeQuery(`
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE datname = $1
                  AND pid <> pg_backend_pid()
                  AND application_name <> 'docklet'
            `, [dbName]);
        } catch { /* pool may already be closing — that's fine */ }

        res.json({ paused: true, message: 'Database paused — pgBouncer stopped, all external connections closed' });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// ── Resume database ───────────────────────────────────────────────────────────
router.post('/db/resume', authenticateToken, async (_req, res) => {
    try {
        // Get db name from config — works even when DB is not accepting connections
        const { containerName, poolerContainer, user, db: dbName } = getDbConfig();

        // 1. Re-allow connections via docker exec inside the container (no pool needed)
        await dockerPsql(containerName, user, `ALTER DATABASE "${dbName}" WITH ALLOW_CONNECTIONS true`);

        // 2. Restart pgBouncer so external clients can reach the database again
        await dockerStart(poolerContainer);

        // 3. Flush dead pool connections so Docklet reconnects cleanly
        await resetPool();

        res.json({ paused: false, message: 'Database resumed — pgBouncer restarted, connections allowed' });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// ── Reset database ────────────────────────────────────────────────────────────
router.post('/db/reset', authenticateToken, async (_req, res) => {
    try {
        const tables = await executeQuery(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
        for (const row of tables.rows) {
            await executeQuery(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE`);
        }
        res.json({ message: 'Database reset — all tables dropped', dropped: tables.rows.length });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
