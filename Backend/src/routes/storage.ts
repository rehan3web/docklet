import express from 'express';
import fs from 'fs';
import Docker from 'dockerode';
import { authenticateToken } from '../middleware/auth';
import { executeQuery } from '../lib/db';
import dns from 'dns/promises';
import {
    S3Client,
    ListBucketsCommand,
    CreateBucketCommand,
    DeleteBucketCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
    CopyObjectCommand,
    GetObjectCommand,
    GetBucketPolicyCommand,
    PutBucketPolicyCommand,
    DeleteBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import multer from 'multer';

const router = express.Router();
router.use(authenticateToken);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 200 * 1024 * 1024 },
});

// ── DB setup ──────────────────────────────────────────────────────────────────
(async () => {
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS storage_config (
            id INTEGER PRIMARY KEY DEFAULT 1,
            endpoint TEXT NOT NULL,
            port INTEGER NOT NULL DEFAULT 9000,
            access_key TEXT NOT NULL,
            secret_key TEXT NOT NULL,
            region TEXT NOT NULL DEFAULT 'us-east-1',
            use_ssl BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await executeQuery(`
        CREATE TABLE IF NOT EXISTS storage_domains (
            id INTEGER PRIMARY KEY DEFAULT 1,
            domain TEXT NOT NULL,
            verified BOOLEAN NOT NULL DEFAULT FALSE,
            nginx_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
})().catch(console.error);

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getConfig() {
    const { rows } = await executeQuery('SELECT * FROM storage_config WHERE id = 1');
    return rows[0] || null;
}

function buildClient(cfg: any): S3Client {
    const scheme = cfg.use_ssl ? 'https' : 'http';
    return new S3Client({
        endpoint: `${scheme}://${cfg.endpoint}:${cfg.port}`,
        region: cfg.region || 'us-east-1',
        credentials: { accessKeyId: cfg.access_key, secretAccessKey: cfg.secret_key },
        forcePathStyle: true,
    });
}

async function requireClient(res: express.Response): Promise<S3Client | null> {
    const cfg = await getConfig();
    if (!cfg) {
        res.status(503).json({ message: 'Storage not connected — configure MinIO endpoint first.' });
        return null;
    }
    return buildClient(cfg);
}

// ── Connection ────────────────────────────────────────────────────────────────
router.post('/connect', async (req, res) => {
    const { endpoint, port, access_key, secret_key, region, use_ssl } = req.body;
    if (!endpoint || !access_key || !secret_key) {
        return res.status(400).json({ message: 'endpoint, access_key and secret_key are required' });
    }
    const cfg = {
        endpoint: String(endpoint).trim(),
        port: parseInt(String(port)) || 9000,
        access_key: String(access_key),
        secret_key: String(secret_key),
        region: String(region || 'us-east-1'),
        use_ssl: !!use_ssl,
    };
    try {
        await buildClient(cfg).send(new ListBucketsCommand({}));
    } catch (err: any) {
        return res.status(400).json({ message: `Connection failed: ${err.message}` });
    }
    await executeQuery(
        `INSERT INTO storage_config (id, endpoint, port, access_key, secret_key, region, use_ssl, updated_at)
         VALUES (1, $1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (id) DO UPDATE SET
             endpoint = EXCLUDED.endpoint, port = EXCLUDED.port,
             access_key = EXCLUDED.access_key, secret_key = EXCLUDED.secret_key,
             region = EXCLUDED.region, use_ssl = EXCLUDED.use_ssl, updated_at = NOW()`,
        [cfg.endpoint, cfg.port, cfg.access_key, cfg.secret_key, cfg.region, cfg.use_ssl]
    );
    res.json({ ok: true });
});

router.get('/connection', async (_req, res) => {
    const cfg = await getConfig();
    if (!cfg) return res.json({ connected: false });
    res.json({ connected: true, endpoint: cfg.endpoint, port: cfg.port, region: cfg.region, use_ssl: cfg.use_ssl });
});

router.delete('/connection', async (_req, res) => {
    await executeQuery('DELETE FROM storage_config WHERE id = 1');
    res.json({ ok: true });
});

// ── Buckets ───────────────────────────────────────────────────────────────────
router.get('/buckets', async (_req, res) => {
    const client = await requireClient(res);
    if (!client) return;
    try {
        const result = await client.send(new ListBucketsCommand({}));
        res.json({ buckets: (result.Buckets || []).map(b => ({ name: b.Name, createdAt: b.CreationDate })) });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
});

router.post('/buckets', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'name is required' });
    const client = await requireClient(res);
    if (!client) return;
    try {
        await client.send(new CreateBucketCommand({ Bucket: String(name) }));
        res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
});

router.delete('/buckets/:bucket', async (req, res) => {
    const client = await requireClient(res);
    if (!client) return;
    const bucket = String(req.params.bucket);
    try {
        let token: string | undefined;
        do {
            const list = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
            if (list.Contents && list.Contents.length > 0) {
                await client.send(new DeleteObjectsCommand({
                    Bucket: bucket,
                    Delete: { Objects: list.Contents.map(o => ({ Key: o.Key! })) },
                }));
            }
            token = list.IsTruncated ? list.NextContinuationToken : undefined;
        } while (token);
        await client.send(new DeleteBucketCommand({ Bucket: bucket }));
        res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ── Files ─────────────────────────────────────────────────────────────────────
router.get('/buckets/:bucket/files', async (req, res) => {
    const client = await requireClient(res);
    if (!client) return;
    const bucket = String(req.params.bucket);
    const prefix = String(req.query.prefix || '');
    try {
        let files: any[] = [];
        let token: string | undefined;
        do {
            const result = await client.send(new ListObjectsV2Command({
                Bucket: bucket, Prefix: prefix, MaxKeys: 1000, ContinuationToken: token,
            }));
            (result.Contents || []).forEach(o => files.push({
                key: o.Key, size: o.Size, lastModified: o.LastModified, etag: o.ETag,
            }));
            token = result.IsTruncated ? result.NextContinuationToken : undefined;
        } while (token);
        res.json({ files });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
});

router.post('/buckets/:bucket/files', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file provided' });
    const client = await requireClient(res);
    if (!client) return;
    const bucket = String(req.params.bucket);
    const key = String(req.body.key || req.file.originalname);
    try {
        await client.send(new PutObjectCommand({
            Bucket: bucket, Key: key,
            Body: req.file.buffer,
            ContentType: req.file.mimetype,
            ContentLength: req.file.size,
        }));
        res.json({ ok: true, key });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
});

router.delete('/buckets/:bucket/files', async (req, res) => {
    const client = await requireClient(res);
    if (!client) return;
    const bucket = String(req.params.bucket);
    const keys: string[] = req.body.keys || [];
    if (!keys.length) return res.status(400).json({ message: 'keys[] required' });
    try {
        if (keys.length === 1) {
            await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: keys[0] }));
        } else {
            await client.send(new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: { Objects: keys.map(k => ({ Key: k })) },
            }));
        }
        res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
});

router.put('/buckets/:bucket/files/rename', async (req, res) => {
    const { oldKey, newKey } = req.body;
    if (!oldKey || !newKey) return res.status(400).json({ message: 'oldKey and newKey required' });
    const client = await requireClient(res);
    if (!client) return;
    const bucket = String(req.params.bucket);
    try {
        await client.send(new CopyObjectCommand({
            Bucket: bucket, CopySource: `${bucket}/${oldKey}`, Key: newKey,
        }));
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: oldKey }));
        res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
});

router.get('/buckets/:bucket/files/download', async (req, res) => {
    const key = String(req.query.key || '');
    if (!key) return res.status(400).json({ message: 'key is required' });
    const cfg = await getConfig();
    if (!cfg) return res.status(503).json({ message: 'Not connected' });
    try {
        const url = await getSignedUrl(
            buildClient(cfg),
            new GetObjectCommand({ Bucket: String(req.params.bucket), Key: key }),
            { expiresIn: 3600 }
        );
        res.json({ url });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ── Domain Management ─────────────────────────────────────────────────────────
const NGINX_CONTAINER = 'docklet-nginx';
const NGINX_CONF_PATH = '/etc/nginx/conf.d/minio-domain.conf';

async function getPublicIP(): Promise<string> {
    const services = ['https://api.ipify.org', 'https://ifconfig.me/ip', 'https://icanhazip.com'];
    for (const svc of services) {
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 3000);
            const r = await fetch(svc, { signal: ctrl.signal });
            clearTimeout(t);
            const ip = (await r.text()).trim();
            if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
        } catch { /* try next */ }
    }
    return '';
}

async function execInContainer(name: string, cmd: string): Promise<string> {
    const docker = getDocker();
    const exec = await docker.getContainer(name).exec({
        Cmd: ['sh', '-c', cmd],
        AttachStdout: true,
        AttachStderr: true,
    });
    return new Promise<string>((resolve, reject) => {
        exec.start({ Detach: false }, (err: any, stream: any) => {
            if (err) return reject(err);
            let out = '';
            docker.modem.demuxStream(
                stream,
                { write: (d: Buffer) => { out += d.toString(); } } as any,
                { write: (d: Buffer) => { out += d.toString(); } } as any
            );
            stream.on('end', () => resolve(out.trim()));
            stream.on('error', reject);
        });
    });
}

// GET /storage/domain
router.get('/domain', async (_req, res) => {
    const { rows } = await executeQuery('SELECT * FROM storage_domains WHERE id = 1');
    const serverIP = await getPublicIP();
    res.json({ domain: rows[0] || null, serverIP });
});

// POST /storage/domain — save domain
router.post('/domain', async (req, res) => {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ message: 'domain is required' });
    const clean = String(domain).toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '').trim();
    const serverIP = await getPublicIP();
    await executeQuery(
        `INSERT INTO storage_domains (id, domain, verified, nginx_enabled, updated_at)
         VALUES (1, $1, FALSE, FALSE, NOW())
         ON CONFLICT (id) DO UPDATE SET domain=$1, verified=FALSE, nginx_enabled=FALSE, updated_at=NOW()`,
        [clean]
    );
    res.json({ ok: true, domain: clean, serverIP });
});

// POST /storage/domain/verify — DNS check
router.post('/domain/verify', async (_req, res) => {
    const { rows } = await executeQuery('SELECT * FROM storage_domains WHERE id = 1');
    if (!rows[0]) return res.status(400).json({ message: 'No domain configured' });
    const { domain } = rows[0];
    const serverIP = await getPublicIP();
    let resolved: string[] = [];
    try {
        resolved = await dns.resolve4(domain);
    } catch (err: any) {
        return res.json({ verified: false, domain, resolved: [], serverIP, reason: `DNS not found: ${err.message}` });
    }
    const verified = !!(serverIP && resolved.includes(serverIP));
    if (verified) {
        await executeQuery('UPDATE storage_domains SET verified=TRUE, updated_at=NOW() WHERE id=1');
    }
    res.json({ verified, domain, resolved, serverIP });
});

// POST /storage/domain/nginx — write nginx config and reload
router.post('/domain/nginx', async (_req, res) => {
    if (!dockerOk()) return res.status(503).json({ message: 'Docker not available' });
    const { rows } = await executeQuery('SELECT * FROM storage_domains WHERE id = 1');
    if (!rows[0]) return res.status(400).json({ message: 'No domain configured' });
    if (!rows[0].verified) return res.status(400).json({ message: 'Domain not verified yet' });
    const cfg = await getConfig();
    if (!cfg) return res.status(400).json({ message: 'MinIO not connected' });
    try { await getDocker().getContainer(NGINX_CONTAINER).inspect(); }
    catch { return res.status(503).json({ message: `Nginx container '${NGINX_CONTAINER}' not found` }); }

    const { domain } = rows[0];
    const upstream = cfg.endpoint;
    const nginxConf = `# Docklet MinIO - ${domain}\nserver {\n    listen 80;\n    server_name ${domain};\n    ignore_invalid_headers off;\n    client_max_body_size 0;\n    proxy_buffering off;\n    proxy_request_buffering off;\n\n    location / {\n        proxy_pass http://${upstream}:9000;\n        proxy_set_header Host $http_host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n        proxy_connect_timeout 300;\n        proxy_http_version 1.1;\n        proxy_set_header Connection "";\n        chunked_transfer_encoding off;\n    }\n}\n`;
    const b64 = Buffer.from(nginxConf).toString('base64');
    const cmd = `echo '${b64}' | base64 -d > ${NGINX_CONF_PATH} && nginx -t 2>&1 && nginx -s reload`;
    try {
        const out = await execInContainer(NGINX_CONTAINER, cmd);
        if (out.includes('failed') || out.includes('error')) {
            return res.status(500).json({ message: `Nginx config error: ${out}` });
        }
        await executeQuery('UPDATE storage_domains SET nginx_enabled=TRUE, updated_at=NOW() WHERE id=1');
        res.json({ ok: true, domain });
    } catch (err: any) {
        res.status(500).json({ message: `Nginx setup failed: ${err.message}` });
    }
});

// DELETE /storage/domain — remove domain + nginx config
router.delete('/domain', async (_req, res) => {
    const { rows } = await executeQuery('SELECT * FROM storage_domains WHERE id = 1');
    if (rows[0]?.nginx_enabled && dockerOk()) {
        try { await execInContainer(NGINX_CONTAINER, `rm -f ${NGINX_CONF_PATH} && nginx -s reload`); }
        catch { /* best-effort */ }
    }
    await executeQuery('DELETE FROM storage_domains WHERE id = 1');
    res.json({ ok: true });
});

// ── Bucket Policy ─────────────────────────────────────────────────────────────
router.get('/buckets/:bucket/policy', async (req, res) => {
    const client = await requireClient(res);
    if (!client) return;
    const bucket = String(req.params.bucket);
    try {
        const result = await client.send(new GetBucketPolicyCommand({ Bucket: bucket }));
        const policy = JSON.parse(result.Policy || '{}');
        const isPublic = (policy.Statement || []).some((s: any) =>
            s.Effect === 'Allow' &&
            (s.Principal === '*' || s.Principal?.AWS === '*' || (Array.isArray(s.Principal?.AWS) && s.Principal.AWS.includes('*'))) &&
            [s.Action].flat().some((a: string) => a === 's3:GetObject' || a === 's3:*')
        );
        res.json({ isPublic });
    } catch (err: any) {
        if (err.name === 'NoSuchBucketPolicy' || err.Code === 'NoSuchBucketPolicy') return res.json({ isPublic: false });
        res.status(500).json({ message: err.message });
    }
});

router.put('/buckets/:bucket/policy', async (req, res) => {
    const { public: makePublic } = req.body;
    const client = await requireClient(res);
    if (!client) return;
    const bucket = String(req.params.bucket);
    try {
        if (makePublic) {
            await client.send(new PutBucketPolicyCommand({
                Bucket: bucket,
                Policy: JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [{ Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${bucket}/*`] }],
                }),
            }));
        } else {
            await client.send(new DeleteBucketPolicyCommand({ Bucket: bucket }));
        }
        res.json({ ok: true, isPublic: !!makePublic });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// ── Share Links ───────────────────────────────────────────────────────────────
router.post('/buckets/:bucket/files/share', async (req, res) => {
    const { key, expiresIn } = req.body;
    if (!key) return res.status(400).json({ message: 'key is required' });
    const expiry = Math.min(Math.max(parseInt(String(expiresIn)) || 3600, 60), 604800);
    const cfg = await getConfig();
    if (!cfg) return res.status(503).json({ message: 'Not connected' });
    try {
        const url = await getSignedUrl(
            buildClient(cfg),
            new GetObjectCommand({ Bucket: String(req.params.bucket), Key: key }),
            { expiresIn: expiry }
        );
        res.json({ url, expiresIn: expiry, expiresAt: new Date(Date.now() + expiry * 1000).toISOString() });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ── MinIO Instance Management ─────────────────────────────────────────────────
const MINIO_IMAGE = 'minio/minio:latest';
const MINIO_NAME = 'docklet-minio';
const MINIO_DATA = '/var/lib/docklet/minio-data';

let _docker: Docker | null = null;
function getDocker(): Docker {
    if (!_docker) _docker = new Docker({ socketPath: '/var/run/docker.sock' });
    return _docker;
}
function dockerOk(): boolean {
    return fs.existsSync('/var/run/docker.sock');
}

function pullImage(tag: string): Promise<void> {
    return new Promise((resolve, reject) => {
        getDocker().pull(tag, (err: any, stream: any) => {
            if (err) return reject(err);
            getDocker().modem.followProgress(stream, (e: any) => e ? reject(e) : resolve());
        });
    });
}

// Read own container ID from /etc/hostname (works inside Docker)
function getSelfContainerId(): string | null {
    try { return fs.readFileSync('/etc/hostname', 'utf8').trim(); } catch { return null; }
}

// Attach a container to all networks the backend server is on
async function joinBackendNetworks(containerName: string): Promise<string> {
    const selfId = getSelfContainerId();
    let sharedEndpoint = containerName; // Docker DNS fallback

    if (selfId) {
        try {
            const selfInfo = await getDocker().getContainer(selfId).inspect();
            const selfNets = selfInfo.NetworkSettings?.Networks || {};
            for (const netName of Object.keys(selfNets)) {
                try {
                    await getDocker().getNetwork(netName).connect({ Container: containerName });
                } catch { /* already connected or not connectable */ }
            }
            // Give Docker a moment to assign the IP on the new network
            await new Promise(r => setTimeout(r, 800));
            // Get IP on the shared network
            const minioInfo = await getDocker().getContainer(containerName).inspect();
            const minioNets = minioInfo.NetworkSettings?.Networks || {};
            for (const netName of Object.keys(selfNets)) {
                if (minioNets[netName]?.IPAddress) {
                    sharedEndpoint = minioNets[netName].IPAddress;
                    break;
                }
            }
        } catch { /* fall through to container name */ }
    }
    return sharedEndpoint;
}

// GET /storage/instance — status of the managed MinIO container
router.get('/instance', async (_req, res) => {
    if (!dockerOk()) return res.json({ exists: false, running: false, dockerAvailable: false });
    try {
        const info = await getDocker().getContainer(MINIO_NAME).inspect();
        res.json({ exists: true, running: info.State.Running, id: info.Id.slice(0, 12), dockerAvailable: true });
    } catch {
        res.json({ exists: false, running: false, dockerAvailable: true });
    }
});

// GET /storage/instance/health — polls MinIO readiness; saves config on first success
// Frontend calls this repeatedly after POST /instance returns
router.get('/instance/health', async (_req, res) => {
    if (!dockerOk()) return res.json({ ready: false, reason: 'Docker not available' });
    try {
        const info = await getDocker().getContainer(MINIO_NAME).inspect();
        if (!info.State.Running) return res.json({ ready: false, reason: 'Container not running' });

        // Grab stored pending credentials
        const { rows } = await executeQuery('SELECT * FROM storage_instance_pending WHERE id = 1');
        if (!rows[0]) return res.json({ ready: false, reason: 'No pending instance' });

        const { access_key, secret_key, endpoint } = rows[0];
        const cfg = { endpoint, port: 9000, access_key, secret_key, region: 'us-east-1', use_ssl: false };
        try {
            await buildClient(cfg).send(new ListBucketsCommand({}));
        } catch {
            return res.json({ ready: false, reason: 'MinIO not yet accepting connections' });
        }

        // MinIO is ready — promote to live config
        await executeQuery(
            `INSERT INTO storage_config (id, endpoint, port, access_key, secret_key, region, use_ssl, updated_at)
             VALUES (1, $3, 9000, $1, $2, 'us-east-1', FALSE, NOW())
             ON CONFLICT (id) DO UPDATE SET
                 endpoint = $3, port = 9000, access_key = $1, secret_key = $2,
                 region = 'us-east-1', use_ssl = FALSE, updated_at = NOW()`,
            [access_key, secret_key, endpoint]
        );
        await executeQuery('DELETE FROM storage_instance_pending WHERE id = 1');
        res.json({ ready: true, endpoint, port: 9000 });
    } catch (err: any) {
        res.json({ ready: false, reason: err.message });
    }
});

// POST /storage/instance — pull image, create container, join backend network, return quickly
// The frontend then polls /instance/health until MinIO is ready
router.post('/instance', async (req, res) => {
    const { access_key, secret_key } = req.body;
    if (!access_key || !secret_key)
        return res.status(400).json({ message: 'access_key and secret_key are required' });
    if (secret_key.length < 8)
        return res.status(400).json({ message: 'Secret key must be at least 8 characters' });
    if (!dockerOk())
        return res.status(503).json({ message: 'Docker is not available on this host' });

    try {
        // Remove any existing container
        try { await getDocker().getContainer(MINIO_NAME).remove({ force: true }); } catch { /* ok */ }

        // Pull image (fast if already cached)
        await pullImage(MINIO_IMAGE);

        // Create data dir
        try { fs.mkdirSync(MINIO_DATA, { recursive: true }); } catch { /* ok */ }

        // Create and start container
        const container = await getDocker().createContainer({
            Image: 'minio/minio',
            name: MINIO_NAME,
            Cmd: ['server', '/data', '--console-address', ':9001'],
            Env: [`MINIO_ROOT_USER=${access_key}`, `MINIO_ROOT_PASSWORD=${secret_key}`],
            ExposedPorts: { '9000/tcp': {}, '9001/tcp': {} },
            HostConfig: {
                PortBindings: {
                    '9000/tcp': [{ HostPort: '9000' }],
                    '9001/tcp': [{ HostPort: '9001' }],
                },
                Binds: [`${MINIO_DATA}:/data`],
                RestartPolicy: { Name: 'unless-stopped' },
            },
        });
        await container.start();

        // Join backend's Docker network so we can reach MinIO by IP
        const endpoint = await joinBackendNetworks(MINIO_NAME);

        // Store credentials temporarily so /health can verify and save them
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS storage_instance_pending (
                id INTEGER PRIMARY KEY DEFAULT 1,
                access_key TEXT NOT NULL,
                secret_key TEXT NOT NULL,
                endpoint TEXT NOT NULL
            )
        `);
        await executeQuery(
            `INSERT INTO storage_instance_pending (id, access_key, secret_key, endpoint) VALUES (1, $1, $2, $3)
             ON CONFLICT (id) DO UPDATE SET access_key=$1, secret_key=$2, endpoint=$3`,
            [access_key, secret_key, endpoint]
        );

        res.json({ ok: true, endpoint });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// DELETE /storage/instance — stop and remove the managed MinIO container
router.delete('/instance', async (_req, res) => {
    if (!dockerOk()) return res.status(503).json({ message: 'Docker not available' });
    try { await getDocker().getContainer(MINIO_NAME).remove({ force: true }); } catch { /* ok */ }
    await executeQuery('DELETE FROM storage_config WHERE id = 1').catch(() => {});
    await executeQuery('DELETE FROM storage_instance_pending WHERE id = 1').catch(() => {});
    res.json({ ok: true });
});

export default router;

