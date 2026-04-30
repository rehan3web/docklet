import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { executeQuery } from '../lib/db';
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

export default router;
