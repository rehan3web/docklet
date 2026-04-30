import express from 'express';
import Docker from 'dockerode';
import fs from 'fs';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

let docker: Docker | null = null;
let dockerError: string | null = null;

function getDocker(): Docker {
    if (docker) return docker;
    try {
        docker = new Docker({ socketPath: '/var/run/docker.sock' });
        return docker;
    } catch (err: any) {
        dockerError = err.message;
        throw err;
    }
}

function dockerAvailable(): { ok: boolean; reason?: string } {
    try {
        if (!fs.existsSync('/var/run/docker.sock')) {
            return { ok: false, reason: 'Docker socket /var/run/docker.sock not found. Docker is not installed or not running on this host.' };
        }
        return { ok: true };
    } catch (err: any) {
        return { ok: false, reason: err.message };
    }
}

router.get('/status', authenticateToken, async (_req, res) => {
    const avail = dockerAvailable();
    if (!avail.ok) return res.json({ available: false, reason: avail.reason });
    try {
        const info = await getDocker().info();
        res.json({
            available: true,
            containers: info.Containers,
            running: info.ContainersRunning,
            stopped: info.ContainersStopped,
            paused: info.ContainersPaused,
            images: info.Images,
            serverVersion: info.ServerVersion,
            os: info.OperatingSystem,
        });
    } catch (err: any) {
        res.json({ available: false, reason: err.message });
    }
});

router.get('/containers', authenticateToken, async (_req, res) => {
    const avail = dockerAvailable();
    if (!avail.ok) return res.status(503).json({ available: false, reason: avail.reason, containers: [] });
    try {
        const list = await getDocker().listContainers({ all: true });
        const containers = list.map(c => ({
            id: c.Id,
            shortId: c.Id.slice(0, 12),
            names: c.Names.map(n => n.replace(/^\//, '')),
            image: c.Image,
            command: c.Command,
            createdAt: c.Created * 1000,
            state: c.State,
            status: c.Status,
            ports: (c.Ports || []).map(p => ({
                privatePort: p.PrivatePort,
                publicPort: p.PublicPort,
                type: p.Type,
            })),
        }));
        res.json({ available: true, containers });
    } catch (err: any) {
        res.status(500).json({ message: err.message || 'Failed to list containers' });
    }
});

async function containerAction(id: string | string[], action: 'start' | 'stop' | 'restart' | 'remove') {
    const c = getDocker().getContainer(String(id));
    if (action === 'start') return c.start();
    if (action === 'stop') return c.stop();
    if (action === 'restart') return c.restart();
    if (action === 'remove') return c.remove({ force: true });
}

router.post('/containers/:id/start', authenticateToken, async (req, res) => {
    const avail = dockerAvailable();
    if (!avail.ok) return res.status(503).json({ message: avail.reason });
    try {
        await containerAction(req.params.id, 'start');
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/containers/:id/stop', authenticateToken, async (req, res) => {
    const avail = dockerAvailable();
    if (!avail.ok) return res.status(503).json({ message: avail.reason });
    try {
        await containerAction(req.params.id, 'stop');
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/containers/:id/restart', authenticateToken, async (req, res) => {
    const avail = dockerAvailable();
    if (!avail.ok) return res.status(503).json({ message: avail.reason });
    try {
        await containerAction(req.params.id, 'restart');
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.delete('/containers/:id', authenticateToken, async (req, res) => {
    const avail = dockerAvailable();
    if (!avail.ok) return res.status(503).json({ message: avail.reason });
    try {
        await containerAction(req.params.id, 'remove');
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/bulk/:action', authenticateToken, async (req, res) => {
    const avail = dockerAvailable();
    if (!avail.ok) return res.status(503).json({ message: avail.reason });
    const action = req.params.action as 'start' | 'stop' | 'restart' | 'remove';
    if (!['start', 'stop', 'restart', 'remove'].includes(action)) {
        return res.status(400).json({ message: 'Invalid bulk action' });
    }
    try {
        const list = await getDocker().listContainers({ all: true });
        const results: { id: string; ok: boolean; error?: string }[] = [];
        for (const c of list) {
            try {
                if (action === 'start' && c.State === 'running') { results.push({ id: c.Id, ok: true }); continue; }
                if (action === 'stop' && c.State !== 'running') { results.push({ id: c.Id, ok: true }); continue; }
                await containerAction(c.Id, action);
                results.push({ id: c.Id, ok: true });
            } catch (err: any) {
                results.push({ id: c.Id, ok: false, error: err.message });
            }
        }
        res.json({ ok: true, results });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
