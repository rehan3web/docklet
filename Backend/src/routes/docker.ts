import express from 'express';
import Docker from 'dockerode';
import fs from 'fs';
import { Socket } from 'socket.io';
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

// ── Container logs ────────────────────────────────────────────────────────────
router.get('/containers/:id/logs', authenticateToken, async (req, res) => {
    const avail = dockerAvailable();
    if (!avail.ok) return res.status(503).json({ message: avail.reason });
    try {
        const tail = parseInt(String(req.query.tail || '300'), 10);
        const container = getDocker().getContainer(String(req.params.id));
        const buf: Buffer[] = [];
        const stream = await container.logs({
            stdout: true, stderr: true, timestamps: true,
            tail: isNaN(tail) ? 300 : tail,
        });
        // dockerode returns a Buffer directly when not multiplexed; handle both
        if (Buffer.isBuffer(stream)) {
            res.json({ logs: stream.toString('utf8') });
        } else {
            (stream as any).on('data', (chunk: Buffer) => buf.push(chunk));
            (stream as any).on('end', () => {
                const raw = Buffer.concat(buf).toString('utf8');
                // Strip 8-byte dockerode multiplexing header from each line
                const lines = raw.split('\n').map(l => l.length > 8 ? l.slice(8) : l).join('\n');
                res.json({ logs: lines });
            });
            (stream as any).on('error', (err: any) => res.status(500).json({ message: err.message }));
        }
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// ── Container stats (CPU %, RAM, Uptime) ─────────────────────────────────────
router.get('/containers/:id/stats', authenticateToken, async (req, res) => {
    const avail = dockerAvailable();
    if (!avail.ok) return res.status(503).json({ message: avail.reason });
    try {
        const container = getDocker().getContainer(String(req.params.id));
        const [statsRaw, info] = await Promise.all([
            container.stats({ stream: false }) as Promise<any>,
            container.inspect(),
        ]);
        // CPU %
        const cpuDelta = (statsRaw.cpu_stats?.cpu_usage?.total_usage ?? 0) -
                         (statsRaw.precpu_stats?.cpu_usage?.total_usage ?? 0);
        const sysDelta = (statsRaw.cpu_stats?.system_cpu_usage ?? 0) -
                         (statsRaw.precpu_stats?.system_cpu_usage ?? 0);
        const numCpus = statsRaw.cpu_stats?.online_cpus ?? statsRaw.cpu_stats?.cpu_usage?.percpu_usage?.length ?? 1;
        const cpuPercent = sysDelta > 0 ? (cpuDelta / sysDelta) * numCpus * 100 : 0;
        // Memory
        const cache = statsRaw.memory_stats?.stats?.cache ?? 0;
        const memUsage = Math.max(0, (statsRaw.memory_stats?.usage ?? 0) - cache);
        const memLimit = statsRaw.memory_stats?.limit ?? 0;
        // Uptime
        const startedAt = info.State?.StartedAt ? new Date(info.State.StartedAt) : null;
        const uptimeMs = startedAt && info.State?.Running ? Date.now() - startedAt.getTime() : 0;
        // Network I/O
        let netRx = 0, netTx = 0;
        for (const iface of Object.values(statsRaw.networks ?? {})) {
            netRx += (iface as any).rx_bytes ?? 0;
            netTx += (iface as any).tx_bytes ?? 0;
        }
        res.json({ cpuPercent: Math.min(cpuPercent, 100), memUsage, memLimit, memPercent: memLimit > 0 ? (memUsage / memLimit) * 100 : 0, uptimeMs, netRx, netTx });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// ── Container inspect (network + mounts) ─────────────────────────────────────
router.get('/containers/:id/inspect', authenticateToken, async (req, res) => {
    const avail = dockerAvailable();
    if (!avail.ok) return res.status(503).json({ message: avail.reason });
    try {
        const container = getDocker().getContainer(String(req.params.id));
        const info = await container.inspect();
        res.json({
            networks: info.NetworkSettings?.Networks ?? {},
            mounts: info.Mounts ?? [],
            hostname: (info.Config as any)?.Hostname ?? null,
        });
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

// ── Docker container exec (terminal) socket handler ───────────────────────────
interface ExecSession { stream: any }
const execSessions = new Map<string, ExecSession>();

export function registerDockerExecSocketHandlers(socket: Socket) {
    const sid = socket.id;

    function closeExec() {
        const s = execSessions.get(sid);
        if (s) {
            try { s.stream.end(); } catch { /* ignore */ }
            execSessions.delete(sid);
        }
    }

    socket.on('docker:exec:start', async ({ containerId, rows, cols }: { containerId: string; rows?: number; cols?: number }) => {
        closeExec();
        if (!dockerAvailable().ok) {
            socket.emit('docker:exec:error', { message: 'Docker is not available' });
            return;
        }
        try {
            const container = getDocker().getContainer(containerId);
            // /bin/sh exists in every container (Alpine ash, Debian dash, etc.)
            // bash is a bonus — try sh first so Alpine containers connect immediately
            const shells = ['/bin/sh', '/bin/bash', 'bash', 'sh'];

            type StreamResult = { stream: any; firstChunk: Buffer | null };

            async function tryShell(shell: string): Promise<StreamResult | null> {
                try {
                    const exec = await container.exec({
                        Cmd: [shell],
                        AttachStdin: true,
                        AttachStdout: true,
                        AttachStderr: true,
                        Tty: true,
                        Env: ['TERM=xterm-256color'],
                    });
                    const stream = await exec.start({ hijack: true, stdin: true });

                    // Race: first data chunk (shell started) vs immediate end (shell not found).
                    // exec.start() does NOT throw when the binary is missing — Docker sends the
                    // OCI error through the stream and then closes it.
                    const firstChunk = await new Promise<Buffer | null>((resolve) => {
                        let settled = false;
                        const finish = (v: Buffer | null) => { if (!settled) { settled = true; resolve(v); } };
                        stream.once('data', (chunk: Buffer) => finish(chunk));
                        stream.once('end',  () => finish(null));
                        stream.once('error', () => finish(null));
                        // Safety timeout: if no event in 3 s, assume it started (rare slow hosts)
                        setTimeout(() => finish(Buffer.alloc(0)), 3000);
                    });

                    if (firstChunk === null) {
                        // Shell binary absent — stream ended immediately
                        try { stream.destroy(); } catch { /* ignore */ }
                        return null;
                    }
                    return { stream, firstChunk };
                } catch {
                    return null;
                }
            }

            let result: StreamResult | null = null;
            for (const shell of shells) {
                result = await tryShell(shell);
                if (result) break;
            }

            if (!result) {
                socket.emit('docker:exec:error', { message: 'No shell found in container (/bin/sh, /bin/bash, bash, sh all failed)' });
                return;
            }

            const { stream: execStream, firstChunk } = result;
            execSessions.set(sid, { stream: execStream });
            socket.emit('docker:exec:ready', {});

            // Replay the first chunk we already consumed during shell detection
            if (firstChunk && firstChunk.length > 0) {
                socket.emit('docker:exec:data', firstChunk.toString('utf8'));
            }

            execStream.on('data', (chunk: Buffer) => {
                socket.emit('docker:exec:data', chunk.toString('utf8'));
            });
            execStream.on('end', () => {
                socket.emit('docker:exec:exit', {});
                execSessions.delete(sid);
            });
            execStream.on('error', (err: any) => {
                socket.emit('docker:exec:error', { message: err.message });
                execSessions.delete(sid);
            });
        } catch (err: any) {
            socket.emit('docker:exec:error', { message: err.message });
        }
    });

    socket.on('docker:exec:input', (data: string) => {
        const s = execSessions.get(sid);
        if (s) {
            try { s.stream.write(data); } catch { /* ignore */ }
        }
    });

    socket.on('docker:exec:resize', ({ rows, cols }: { rows: number; cols: number }) => {
        // Resize is handled by the exec's resize method if accessible
    });

    socket.on('docker:exec:stop', closeExec);

    socket.on('disconnect', closeExec);
}
