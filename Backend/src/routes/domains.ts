import express from 'express';
import dns from 'dns';
import { authenticateToken } from '../middleware/auth';
import { getConnection } from '../lib/db';

const router = express.Router();
const dnsResolver = new dns.promises.Resolver();

// ── Table bootstrap ────────────────────────────────────────────────────────────
let ready = false;
async function ensureTable() {
    if (ready) return;
    const pool = await getConnection();
    await pool.query(`
        CREATE TABLE IF NOT EXISTS verified_domains (
            id         SERIAL PRIMARY KEY,
            domain     TEXT UNIQUE NOT NULL,
            vps_ip     TEXT NOT NULL DEFAULT '',
            verified   BOOLEAN NOT NULL DEFAULT FALSE,
            created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
        )
    `);
    ready = true;
}

// ── Server IP detection ────────────────────────────────────────────────────────
let cachedIp: string | null = null;
async function getServerIp(): Promise<string> {
    if (process.env.SERVER_IP) return process.env.SERVER_IP;
    if (cachedIp) return cachedIp;
    try {
        const r = await fetch('https://api.ipify.org?format=json');
        cachedIp = ((await r.json()) as any).ip;
        return cachedIp!;
    } catch {
        return '';
    }
}
getServerIp().catch(() => {});

// ── DNS helper ─────────────────────────────────────────────────────────────────
async function resolveA(host: string): Promise<string[]> {
    try { return await dnsResolver.resolve4(host); } catch { return []; }
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET /api/domains — list all
router.get('/', authenticateToken, async (_req, res) => {
    try {
        await ensureTable();
        const pool = await getConnection();
        const { rows } = await pool.query(
            'SELECT * FROM verified_domains ORDER BY created_at DESC'
        );
        const ip = await getServerIp();
        res.json({ domains: rows, serverIp: ip });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// GET /api/domains/server-ip
router.get('/server-ip', authenticateToken, async (_req, res) => {
    try {
        const ip = await getServerIp();
        res.json({ ip });
    } catch {
        res.json({ ip: '' });
    }
});

// POST /api/domains — add domain
router.post('/', authenticateToken, async (req, res) => {
    const { domain, vps_ip } = req.body;
    if (!domain?.trim()) return res.status(400).json({ message: 'Domain is required' });
    try {
        await ensureTable();
        const pool = await getConnection();
        const ip = (vps_ip?.trim()) || (await getServerIp());
        const { rows } = await pool.query(
            `INSERT INTO verified_domains (domain, vps_ip)
             VALUES ($1, $2)
             ON CONFLICT (domain) DO UPDATE SET vps_ip = EXCLUDED.vps_ip
             RETURNING *`,
            [domain.trim().toLowerCase(), ip]
        );
        res.json({ domain: rows[0] });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// DELETE /api/domains/:id
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        await ensureTable();
        const pool = await getConnection();
        await pool.query('DELETE FROM verified_domains WHERE id=$1', [req.params.id]);
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// POST /api/domains/:id/verify — check A + wildcard DNS
router.post('/:id/verify', authenticateToken, async (req, res) => {
    try {
        await ensureTable();
        const pool = await getConnection();
        const { rows } = await pool.query('SELECT * FROM verified_domains WHERE id=$1', [req.params.id]);
        if (!rows.length) return res.status(404).json({ message: 'Domain not found' });
        const rec = rows[0];

        const apexIps = await resolveA(rec.domain);
        const wildcardIps = await resolveA(`wildcard-check-${Date.now()}.${rec.domain}`);

        const apexOk = apexIps.includes(rec.vps_ip);
        const wildcardOk = wildcardIps.includes(rec.vps_ip);
        const verified = apexOk && wildcardOk;

        await pool.query('UPDATE verified_domains SET verified=$1 WHERE id=$2', [verified, rec.id]);

        res.json({ verified, apexOk, wildcardOk, apexIps, wildcardIps, vps_ip: rec.vps_ip });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// PATCH /api/domains/:id — update vps_ip / domain
router.patch('/:id', authenticateToken, async (req, res) => {
    try {
        await ensureTable();
        const pool = await getConnection();
        const { vps_ip } = req.body;
        const { rows } = await pool.query(
            'UPDATE verified_domains SET vps_ip=$1, verified=FALSE WHERE id=$2 RETURNING *',
            [vps_ip?.trim(), req.params.id]
        );
        res.json({ domain: rows[0] });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
