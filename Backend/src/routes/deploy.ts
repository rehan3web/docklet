import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { authenticateToken } from '../middleware/auth';
import { emitToUser } from '../lib/socket';

const router = express.Router();

const DEPLOY_ROOT = path.resolve(process.cwd(), '.docklet-deploys');
if (!fs.existsSync(DEPLOY_ROOT)) {
    fs.mkdirSync(DEPLOY_ROOT, { recursive: true });
}

// ── Port registry ─────────────────────────────────────────────────────────────
// Pure in-memory Set — no socket binding, O(1) lookup. Persisted to a JSON
// sidecar file so ports are not re-issued after a backend restart.

const PORT_REGISTRY_FILE = path.join(DEPLOY_ROOT, '.port-registry.json');

interface PortEntry {
    hostPort: number;
    containerName: string;
    containerPort: number;
    deployId: string;
}

const portRegistry = new Map<string, PortEntry>(); // key = deployId
const usedPorts = new Set<number>();

function loadPortRegistry() {
    try {
        const raw = JSON.parse(fs.readFileSync(PORT_REGISTRY_FILE, 'utf8')) as PortEntry[];
        for (const e of raw) {
            portRegistry.set(e.deployId, e);
            usedPorts.add(e.hostPort);
        }
    } catch { /* first run */ }
}

function savePortRegistry() {
    try {
        fs.writeFileSync(PORT_REGISTRY_FILE, JSON.stringify([...portRegistry.values()], null, 2));
    } catch { /* ignore */ }
}

// Instant — no socket binding. Scan from 8000, skip anything already claimed.
function claimPort(): number {
    let p = 8000;
    while (usedPorts.has(p) && p < 8099) p++;
    if (p >= 8099) throw new Error('No free port in 8000–8098');
    usedPorts.add(p);
    return p;
}

loadPortRegistry();

// ── HAProxy config management ─────────────────────────────────────────────────
// The config file is bind-mounted into the docklet-haproxy container.
// We write the full file and send SIGUSR2 (graceful reload) to the container.

const HAPROXY_CFG_PATH = path.resolve(process.cwd(), 'docklet-proxy.cfg');
const HAPROXY_CONTAINER = 'docklet-haproxy';
const HAPROXY_NETWORK = 'docklet-apps';

function buildHAProxyCfg(): string {
    const lines = [
        'global',
        '    maxconn 4096',
        '',
        'defaults',
        '    mode http',
        '    option forwardfor',
        '    option http-server-close',
        '    timeout connect 5s',
        '    timeout client  1m',
        '    timeout server  1m',
        '',
    ];

    for (const entry of portRegistry.values()) {
        const label = entry.deployId.replace(/[^a-z0-9]/gi, '_').slice(-16);
        lines.push(`listen app_${label}`);
        lines.push(`    bind *:${entry.hostPort}`);
        lines.push(`    server app ${entry.containerName}:${entry.containerPort}`);
        lines.push('');
    }

    // Always keep the placeholder so HAProxy starts cleanly even with zero deploys
    lines.push('listen _ready');
    lines.push('    bind *:8099');
    lines.push('    mode tcp');
    lines.push('    server noop 127.0.0.1:8099');
    lines.push('');

    return lines.join('\n');
}

async function reloadHAProxy(deployId: string) {
    try {
        fs.writeFileSync(HAPROXY_CFG_PATH, buildHAProxyCfg());
    } catch (err: any) {
        emitLog(deployId, 'system', `\n[warning: could not write HAProxy config: ${err.message}]\n`);
        return;
    }
    // Send SIGUSR2 to the HAProxy container for graceful reload — no downtime.
    await runQuiet('docker', ['exec', HAPROXY_CONTAINER, 'sh', '-c', 'kill -USR2 1 || true']);
    emitLog(deployId, 'system', `\nHAProxy reloaded — container accessible on host port ${portRegistry.get(deployId)?.hostPort}\n`);
}

function runQuiet(command: string, args: string[]): Promise<void> {
    return new Promise((resolve) => {
        const child = spawn(command, args);
        child.on('close', () => resolve());
        child.on('error', () => resolve());
    });
}

// ── Dockerfile helpers ────────────────────────────────────────────────────────

// Parse the last EXPOSE line (handles multi-stage Dockerfiles).
function parseExposedPort(dockerfilePath: string): number | null {
    try {
        let last: number | null = null;
        for (const line of fs.readFileSync(dockerfilePath, 'utf8').split('\n')) {
            const m = line.trim().match(/^EXPOSE\s+(\d+)/i);
            if (m) last = parseInt(m[1], 10);
        }
        return last;
    } catch {
        return null;
    }
}

// ── Misc ──────────────────────────────────────────────────────────────────────

interface DeployRecord {
    id: string;
    repo: string;
    name: string;
    ownerId: string;
    status: 'pending' | 'cloning' | 'building' | 'running' | 'failed' | 'success';
    startedAt: number;
    finishedAt?: number;
    error?: string;
    hostPort?: number;
    containerPort?: number;
    containerName?: string;
    logs: { stream: 'stdout' | 'stderr' | 'system'; chunk: string; timestamp: number }[];
}

const deployments = new Map<string, DeployRecord>();

function emitLog(id: string, stream: 'stdout' | 'stderr' | 'system', chunk: string) {
    const entry = { stream, chunk, timestamp: Date.now() };
    const rec = deployments.get(id);
    if (rec) {
        rec.logs.push(entry);
        if (rec.logs.length > 1000) rec.logs.shift();
    }
    if (rec?.ownerId) emitToUser(rec.ownerId, 'deploy-log', { id, ...entry });
}

function emitStatus(id: string, status: DeployRecord['status'], extra?: Record<string, any>) {
    const rec = deployments.get(id);
    if (rec) rec.status = status;
    if (rec?.ownerId) emitToUser(rec.ownerId, 'deploy-status', { id, status, ...extra });
}

function runStreamed(id: string, command: string, args: string[], cwd: string): Promise<number> {
    return new Promise((resolve) => {
        emitLog(id, 'system', `\n$ ${command} ${args.join(' ')}\n`);
        const child = spawn(command, args, { cwd });
        child.stdout.on('data', (d) => emitLog(id, 'stdout', d.toString()));
        child.stderr.on('data', (d) => emitLog(id, 'stderr', d.toString()));
        child.on('error', (err) => {
            emitLog(id, 'stderr', `\n[spawn error: ${err.message}]\n`);
            resolve(-1);
        });
        child.on('close', (code) => resolve(code ?? -1));
    });
}

function deriveProjectName(repo: string): string {
    try {
        return repo.replace(/\.git$/i, '').replace(/\/+$/g, '').split('/').pop() || 'project';
    } catch {
        return 'project';
    }
}

function safeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) || 'project';
}

function dockerAvailable(): boolean {
    try { return fs.existsSync('/var/run/docker.sock'); } catch { return false; }
}

function ownerIdFromReq(req: express.Request): string {
    const u = (req as any).user;
    return String(u?.id ?? u?.username ?? 'anonymous');
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/list', authenticateToken, (req, res) => {
    const ownerId = ownerIdFromReq(req);
    res.json({
        deployments: Array.from(deployments.values())
            .filter(d => d.ownerId === ownerId)
            .map(d => ({
                id: d.id, repo: d.repo, name: d.name, status: d.status,
                startedAt: d.startedAt, finishedAt: d.finishedAt, error: d.error,
                hostPort: d.hostPort, containerPort: d.containerPort, containerName: d.containerName,
            })),
    });
});

router.get('/:id', authenticateToken, (req, res) => {
    const rec = deployments.get(String(req.params.id));
    if (!rec) return res.status(404).json({ message: 'Deployment not found' });
    if (rec.ownerId !== ownerIdFromReq(req)) return res.status(403).json({ message: 'Forbidden' });
    res.json(rec);
});

router.post('/github', authenticateToken, async (req, res) => {
    const { repo } = req.body || {};
    if (!repo || typeof repo !== 'string' || !/^https?:\/\//i.test(repo)) {
        return res.status(400).json({ message: 'A valid HTTP(S) Git repository URL is required.' });
    }

    const id = `dep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const projectName = safeName(deriveProjectName(repo));
    const cloneDir = path.join(DEPLOY_ROOT, `${projectName}-${id}`);
    const imageTag = `docklet-${projectName}-${id}`.toLowerCase();
    const containerName = `nb-${projectName}-${id}`.toLowerCase();

    const record: DeployRecord = {
        id, repo, name: projectName,
        ownerId: ownerIdFromReq(req),
        status: 'pending',
        startedAt: Date.now(),
        logs: [],
    };
    deployments.set(id, record);
    res.json({ id, name: projectName });

    (async () => {
        try {
            emitStatus(id, 'cloning');
            emitLog(id, 'system', `Cloning ${repo} into ${cloneDir}\n`);
            const cloneCode = await runStreamed(id, 'git', ['clone', '--depth', '1', repo, cloneDir], DEPLOY_ROOT);
            if (cloneCode !== 0) {
                record.error = `git clone exited with code ${cloneCode}`;
                record.finishedAt = Date.now();
                return emitStatus(id, 'failed', { error: record.error });
            }

            const dockerfilePath = path.join(cloneDir, 'Dockerfile');
            if (!fs.existsSync(dockerfilePath)) {
                record.error = 'Dockerfile not detected. Deployment failed.';
                record.finishedAt = Date.now();
                emitLog(id, 'stderr', '\n[Dockerfile not detected. Deployment failed.]\n');
                return emitStatus(id, 'failed', { error: record.error });
            }

            if (!dockerAvailable()) {
                record.error = 'Docker socket not found. Mount /var/run/docker.sock to enable deployments.';
                record.finishedAt = Date.now();
                emitLog(id, 'stderr', `\n[${record.error}]\n`);
                return emitStatus(id, 'failed', { error: record.error });
            }

            // Claim a port instantly from the in-memory registry (no socket binding).
            const containerPort = parseExposedPort(dockerfilePath);
            let hostPort: number | null = null;
            if (containerPort) {
                try {
                    hostPort = claimPort();
                    record.containerPort = containerPort;
                    record.hostPort = hostPort;
                    emitLog(id, 'system', `\nDetected EXPOSE ${containerPort} → will proxy via HAProxy on host port ${hostPort}\n`);
                } catch (portErr: any) {
                    emitLog(id, 'system', `\nWarning: ${portErr.message} — starting without port proxy\n`);
                }
            } else {
                emitLog(id, 'system', '\nNo EXPOSE found in Dockerfile — starting without port proxy\n');
            }

            emitStatus(id, 'building');
            emitLog(id, 'system', `\nBuilding image ${imageTag}\n`);
            const buildCode = await runStreamed(id, 'docker', ['build', '-t', imageTag, '.'], cloneDir);
            if (buildCode !== 0) {
                // Release the claimed port if build fails
                if (hostPort) usedPorts.delete(hostPort);
                record.error = `docker build exited with code ${buildCode}`;
                record.finishedAt = Date.now();
                return emitStatus(id, 'failed', { error: record.error });
            }

            emitStatus(id, 'running');
            emitLog(id, 'system', `\nStarting container ${containerName} on network ${HAPROXY_NETWORK}\n`);
            record.containerName = containerName;

            // Run on the docklet-apps network so HAProxy can reach it by name.
            // No -p flag needed — HAProxy handles external access.
            const runCode = await runStreamed(id, 'docker', [
                'run', '-d',
                '--name', containerName,
                '--network', HAPROXY_NETWORK,
                imageTag,
            ], cloneDir);

            if (runCode !== 0) {
                if (hostPort) usedPorts.delete(hostPort);
                record.error = `docker run exited with code ${runCode}`;
                record.finishedAt = Date.now();
                return emitStatus(id, 'failed', { error: record.error });
            }

            // Register in port registry and write + reload HAProxy config.
            if (hostPort && containerPort) {
                const entry: PortEntry = { hostPort, containerName, containerPort, deployId: id };
                portRegistry.set(id, entry);
                savePortRegistry();
                await reloadHAProxy(id);
            }

            record.status = 'success';
            record.finishedAt = Date.now();
            const portMsg = hostPort ? ` — proxied via HAProxy on host port ${hostPort}` : '';
            emitLog(id, 'system', `\nDeployment successful: container ${containerName} is running${portMsg}.\n`);
            emitStatus(id, 'success', { containerName, imageTag, hostPort, containerPort });

        } catch (err: any) {
            record.status = 'failed';
            record.error = err?.message || String(err);
            record.finishedAt = Date.now();
            emitLog(id, 'stderr', `\n[deploy failed: ${record.error}]\n`);
            emitStatus(id, 'failed', { error: record.error });
        }
    })();
});

export default router;
