import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import dns from 'dns';
import { authenticateToken } from '../middleware/auth';
import { getConnection } from '../lib/db';
import { emitToUser } from '../lib/socket';

const router = express.Router();
const dnsResolver = new dns.promises.Resolver();

const NGINX_CONFIGS_DIR = path.join(process.cwd(), 'nginx-configs');
const NGINX_CONTAINER = process.env.NGINX_CONTAINER_NAME || 'docklet-nginx';
const SELF_CONTAINER = process.env.SELF_CONTAINER_NAME || 'docklet-server';

if (!fs.existsSync(NGINX_CONFIGS_DIR)) {
    try { fs.mkdirSync(NGINX_CONFIGS_DIR, { recursive: true }); } catch { /* ignore */ }
}

// ── DB ────────────────────────────────────────────────────────────────────────

let dbReady = false;
async function ensureTable() {
    if (dbReady) return;
    const pool = await getConnection();
    // Migrate old table name if it exists and the new one does not yet
    await pool.query(`
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'nextbase_proxy_domains')
               AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'docklet_proxy_domains')
            THEN
                ALTER TABLE nextbase_proxy_domains RENAME TO docklet_proxy_domains;
            END IF;
        END
        $$;
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS docklet_proxy_domains (
            id          SERIAL PRIMARY KEY,
            domain      VARCHAR(255) UNIQUE NOT NULL,
            target_port INTEGER NOT NULL,
            verified    BOOLEAN DEFAULT FALSE,
            ssl_enabled BOOLEAN DEFAULT FALSE,
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    dbReady = true;
}

// ── Server-IP detection ───────────────────────────────────────────────────────

let cachedIp: string | null = null;
async function getServerIp(): Promise<string> {
    if (process.env.SERVER_IP) return process.env.SERVER_IP;
    if (cachedIp) return cachedIp;
    try {
        const r = await fetch('https://api.ipify.org?format=json');
        cachedIp = ((await r.json()) as any).ip;
        return cachedIp!;
    } catch {
        return 'YOUR_SERVER_IP';
    }
}
getServerIp().catch(() => {});

// ── Helpers ───────────────────────────────────────────────────────────────────

function ownerFromReq(req: express.Request): string {
    const u = (req as any).user;
    return String(u?.id ?? u?.username ?? 'anonymous');
}

/** true = example.com  false = sub.example.com */
function isRoot(domain: string): boolean {
    return domain.split('.').length === 2;
}
function serverNames(domain: string): string {
    return isRoot(domain) ? `${domain} www.${domain}` : domain;
}
function certDomainArgs(domain: string): string[] {
    return (isRoot(domain) ? [domain, `www.${domain}`] : [domain]).flatMap(d => ['-d', d]);
}

// ── Nginx templates ───────────────────────────────────────────────────────────
// Upstream target: the host machine's IP so Docker containers (docklet-nginx)
// can reach any port exposed by other containers or services on the host.
// We use the actual VPS IP rather than `docklet-haproxy` (which is not always
// running) or `localhost` (which resolves to the nginx container itself).

function nginxHttp(domain: string, port: number, serverIp: string): string {
    const names = serverNames(domain);
    return `# Managed by Docklet — do not edit manually
server {
    listen 80;
    server_name ${names};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        proxy_pass http://${serverIp}:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
`;
}

function nginxHttps(domain: string, port: number, serverIp: string): string {
    const names = serverNames(domain);
    return `# Managed by Docklet — do not edit manually
server {
    listen 80;
    server_name ${names};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name ${names};

    ssl_certificate     /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:NB_SSL:10m;
    ssl_session_timeout 1d;

    location / {
        proxy_pass http://${serverIp}:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
`;
}

async function writeConfig(domain: string, port: number, ssl: boolean): Promise<void> {
    const serverIp = await getServerIp();
    fs.writeFileSync(
        path.join(NGINX_CONFIGS_DIR, `${domain}.conf`),
        ssl ? nginxHttps(domain, port, serverIp) : nginxHttp(domain, port, serverIp)
    );
}

function reloadNginx(): Promise<void> {
    return new Promise((resolve) => {
        const child = spawn('docker', ['exec', NGINX_CONTAINER, 'nginx', '-s', 'reload']);
        child.on('close', () => resolve());
        child.on('error', () => resolve());
    });
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/server-ip', authenticateToken, async (_req, res) => {
    res.json({ ip: await getServerIp() });
});

router.get('/list', authenticateToken, async (_req, res) => {
    try {
        await ensureTable();
        const pool = await getConnection();
        const { rows } = await pool.query('SELECT * FROM docklet_proxy_domains ORDER BY created_at DESC');
        res.json({ domains: rows });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/create', authenticateToken, async (req, res) => {
    const { domain, targetPort } = req.body || {};
    if (!domain || typeof domain !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
        return res.status(400).json({ message: 'Valid domain required (e.g. example.com or app.example.com)' });
    }
    const port = Number(targetPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return res.status(400).json({ message: 'Valid port (1–65535) required' });
    }
    try {
        await ensureTable();
        const pool = await getConnection();
        const { rows } = await pool.query(
            `INSERT INTO docklet_proxy_domains (domain, target_port)
             VALUES ($1, $2)
             ON CONFLICT (domain) DO UPDATE SET target_port = $2, updated_at = NOW()
             RETURNING *`,
            [domain.toLowerCase(), port]
        );
        await writeConfig(domain.toLowerCase(), port, false);
        await reloadNginx();
        res.json({ domain: rows[0] });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/verify/:id', authenticateToken, async (req, res) => {
    try {
        await ensureTable();
        const pool = await getConnection();
        const { rows } = await pool.query('SELECT * FROM docklet_proxy_domains WHERE id = $1', [req.params.id]);
        if (!rows[0]) return res.status(404).json({ message: 'Domain not found' });
        const domain: string = rows[0].domain;
        const serverIp = await getServerIp();

        let found: string[] = [];
        let ok = false;
        try {
            found = await dnsResolver.resolve4(domain);
            ok = found.includes(serverIp);
        } catch (e: any) {
            return res.status(400).json({ verified: false, message: `DNS lookup failed: ${e.message}`, found: [], expected: serverIp });
        }

        if (!ok) {
            return res.status(400).json({
                verified: false,
                message: `A record not pointing to this server (${serverIp}). Found: ${found.join(', ') || 'none'}`,
                found,
                expected: serverIp,
            });
        }

        await pool.query('UPDATE docklet_proxy_domains SET verified = TRUE, updated_at = NOW() WHERE id = $1', [req.params.id]);
        res.json({ verified: true, ip: serverIp });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/ssl/:id', authenticateToken, async (req, res) => {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: 'Valid email required for Let\'s Encrypt' });
    }
    try {
        await ensureTable();
        const pool = await getConnection();
        const { rows } = await pool.query('SELECT * FROM docklet_proxy_domains WHERE id = $1', [req.params.id]);
        if (!rows[0]) return res.status(404).json({ message: 'Domain not found' });
        if (!rows[0].verified) return res.status(400).json({ message: 'Domain must be DNS-verified first' });

        const domain: string = rows[0].domain;
        const port: number = rows[0].target_port;
        const userId = ownerFromReq(req);
        const taskId = `ssl_${req.params.id}`;
        const domainId = req.params.id;

        res.json({ started: true, taskId });

        (async () => {
            const log = (chunk: string, stream: 'stdout' | 'stderr' | 'system' = 'stdout') => {
                emitToUser(userId, 'ssl-log', { id: taskId, domain, chunk, stream });
            };
            const status = (s: 'running' | 'success' | 'failed', message?: string) => {
                emitToUser(userId, 'ssl-status', { id: taskId, domain, status: s, message });
            };

            status('running', 'Certbot starting...');
            log(`\nRequesting Let's Encrypt certificate for ${domain}\n`, 'system');

            const ok = await new Promise<boolean>((resolve) => {
                const child = spawn('docker', [
                    'run', '--rm',
                    '--volumes-from', SELF_CONTAINER,
                    'certbot/certbot', 'certonly',
                    '--webroot', '-w', '/var/www/certbot',
                    '--non-interactive', '--agree-tos',
                    '--email', email,
                    ...certDomainArgs(domain),
                ]);
                child.stdout.on('data', d => log(d.toString()));
                child.stderr.on('data', d => log(d.toString(), 'stderr'));
                child.on('error', err => { log(`\n[error: ${err.message}]\n`, 'stderr'); resolve(false); });
                child.on('close', code => resolve(code === 0));
            });

            if (!ok) { status('failed', 'Certbot exited with errors'); return; }

            log('\nWriting SSL nginx config...\n', 'system');
            await writeConfig(domain, port, true);
            await reloadNginx();
            log('nginx reloaded.\n', 'system');

            await pool.query('UPDATE docklet_proxy_domains SET ssl_enabled = TRUE, updated_at = NOW() WHERE id = $1', [domainId]);
            status('success', `https://${domain} is live`);
        })();
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/reload', authenticateToken, async (_req, res) => {
    try {
        await ensureTable();
        const pool = await getConnection();
        const { rows } = await pool.query('SELECT * FROM docklet_proxy_domains');
        for (const row of rows) {
            await writeConfig(row.domain, row.target_port, row.ssl_enabled ?? false);
        }
        await reloadNginx();
        res.json({ ok: true, rewritten: rows.length });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        await ensureTable();
        const pool = await getConnection();
        const { rows } = await pool.query('DELETE FROM docklet_proxy_domains WHERE id = $1 RETURNING *', [req.params.id]);
        if (!rows[0]) return res.status(404).json({ message: 'Domain not found' });
        try { fs.unlinkSync(path.join(NGINX_CONFIGS_DIR, `${rows[0].domain}.conf`)); } catch { /* ignore */ }
        await reloadNginx();
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
