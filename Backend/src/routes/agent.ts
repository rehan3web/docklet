import express from 'express';
import { spawn, execSync } from 'child_process';
import OpenAI from 'openai';
import { authenticateToken } from '../middleware/auth';
import { getSetting } from '../lib/settings';
import { emitToUser } from '../lib/socket';

const router = express.Router();

const NVIDIA_BASE_URL    = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_DEFAULT_MODEL = 'openai/gpt-oss-120b';

function getUserId(req: any): string {
    const u = req.user;
    return String(u?.id ?? u?.username ?? 'anonymous');
}

function isDockerAvailable(): boolean {
    try {
        execSync('docker info', { stdio: 'pipe', timeout: 5_000 });
        return true;
    } catch { return false; }
}

// Gather live Docker context so the AI can plan around conflicts
function getDockerContext(): string {
    try {
        const containers = execSync(
            'docker ps -a --format "{{.Names}}|{{.Status}}|{{.Ports}}|{{.Image}}"',
            { stdio: 'pipe', timeout: 5_000 }
        ).toString().trim();
        if (!containers) return 'No containers currently exist.';
        const rows = containers.split('\n').map(line => {
            const [name, status, ports, image] = line.split('|');
            return `- ${name} (${image}) [${status}] ports: ${ports || 'none'}`;
        });
        return 'Currently existing containers:\n' + rows.join('\n');
    } catch {
        return 'Unable to fetch container list.';
    }
}

// ── Step types ──────────────────────────────────────────────────────────────

type AgentStep =
    | { type: 'message';        content: string }
    | { type: 'shell';          command: string; description: string; continueOnError?: boolean }
    | { type: 'docker_pull';    image: string; description: string }
    | { type: 'docker_run';     args: string[]; description: string }
    | { type: 'docker_exec';    container: string; command: string; description: string; continueOnError?: boolean }
    | { type: 'docker_stop';    container: string; description: string; continueOnError?: boolean }
    | { type: 'docker_remove';  container: string; description: string; continueOnError?: boolean }
    | { type: 'docker_logs';    container: string; description: string }
    | { type: 'docker_free_port'; port: number; description: string };

type ActionPlan = {
    requiresDocker: boolean;
    summary: string;
    steps: AgentStep[];
};

// ── System prompt ───────────────────────────────────────────────────────────

const AGENT_SYSTEM_PROMPT = `You are an advanced DevOps automation agent inside Docklet — a Docker/VPS management dashboard.

Given a user request and the LIVE DOCKER CONTEXT (containers currently running), generate a precise JSON action plan.

CRITICAL RULES:
1. Always check the live context before planning. If a container or port is already in use, stop/remove it first.
2. NEVER use "shell" with operators like ||, &&, or |. Use separate steps instead.
3. For MongoDB 7+: use "mongosh" NOT "mongo" for exec commands.
4. For redeploy requests: always stop and remove the OLD container first, then free the port, then run new.
5. Use docker_exec for running commands inside containers (changing passwords, config, etc.)
6. Use docker_free_port to release a port before binding it with a new container.
7. Always verify success - set continueOnError:false for critical steps.
8. For credential changes: use docker_exec with the correct CLI tool for that image.
9. Container names: lowercase alphanumeric + hyphens only.
10. Always use --restart=unless-stopped and -d for persistent services.

STEP TYPES:
- "message": { "content": "text to show user" }
- "docker_pull": { "image": "name:tag", "description": "..." }
- "docker_run": { "args": ["-d","--name","...","..."], "description": "..." }  — image is last arg
- "docker_exec": { "container": "name", "command": "mongosh admin --eval \\"...\\"", "description": "...", "continueOnError": false }
- "docker_stop": { "container": "name", "description": "...", "continueOnError": true }
- "docker_remove": { "container": "name", "description": "...", "continueOnError": true }
- "docker_free_port": { "port": 27017, "description": "Free port 27017 before reuse" }
- "docker_logs": { "container": "name", "description": "..." }
- "shell": { "command": "single command no operators", "description": "...", "continueOnError": false }

EXAMPLES OF CORRECT PLANS:

Redeploy MongoDB with new password:
{
  "requiresDocker": true,
  "summary": "Redeploy MongoDB with new credentials",
  "steps": [
    { "type": "message", "content": "Stopping and removing old MongoDB container..." },
    { "type": "docker_stop", "container": "mongo", "description": "Stop old mongo", "continueOnError": true },
    { "type": "docker_remove", "container": "mongo", "description": "Remove old mongo", "continueOnError": true },
    { "type": "docker_free_port", "port": 27017, "description": "Free port 27017" },
    { "type": "docker_pull", "image": "mongo:7", "description": "Pull latest MongoDB 7" },
    { "type": "docker_run", "args": ["-d","--name","mongo","--restart=unless-stopped","-p","27017:27017","-e","MONGO_INITDB_ROOT_USERNAME=admin","-e","MONGO_INITDB_ROOT_PASSWORD=12345678","mongo:7"], "description": "Start new MongoDB" },
    { "type": "docker_logs", "container": "mongo", "description": "Verify MongoDB started" },
    { "type": "message", "content": "MongoDB redeployed. Connect: mongodb://admin:12345678@localhost:27017" }
  ]
}

Change MongoDB password on running container:
{
  "requiresDocker": true,
  "summary": "Update MongoDB admin password",
  "steps": [
    { "type": "message", "content": "Updating MongoDB admin password..." },
    { "type": "docker_exec", "container": "mongo", "command": "mongosh admin -u admin -p oldpass --eval \\"db.changeUserPassword('admin','newpass')\\"", "description": "Change admin password", "continueOnError": false },
    { "type": "message", "content": "MongoDB password updated successfully." }
  ]
}

Respond ONLY with valid JSON. No markdown, no code fences, no explanation outside the JSON.`;

// ── AI planning ─────────────────────────────────────────────────────────────

async function planWithAI(message: string, apiKey: string, model: string): Promise<ActionPlan> {
    const openai  = new OpenAI({ apiKey, baseURL: NVIDIA_BASE_URL });
    const context = isDockerAvailable() ? getDockerContext() : 'Docker is not available on this host.';

    const userContent = `LIVE DOCKER CONTEXT:\n${context}\n\nUSER REQUEST: ${message}`;

    const completion = await openai.chat.completions.create({
        model,
        messages: [
            { role: 'system', content: AGENT_SYSTEM_PROMPT },
            { role: 'user',   content: userContent },
        ],
        temperature: 0.1,
        max_tokens:  3072,
    });

    const raw     = (completion.choices?.[0]?.message?.content || '').trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

    try {
        return JSON.parse(cleaned);
    } catch {
        return {
            requiresDocker: false,
            summary: 'AI response',
            steps: [{ type: 'message', content: cleaned }],
        };
    }
}

// ── Command streaming ────────────────────────────────────────────────────────

function streamCommand(
    command: string,
    args: string[],
    userId: string,
    agentId: string,
    timeout = 300_000
): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve) => {
        const child    = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let output     = '';
        let finished   = false;

        const timer = setTimeout(() => {
            if (!finished) {
                try { child.kill('SIGKILL'); } catch { /* ignore */ }
                emitToUser(userId, 'agent:log', { agentId, type: 'error', content: '[Command timed out]' });
                resolve({ exitCode: -1, output });
            }
        }, timeout);

        child.stdout?.on('data', (d: Buffer) => { const s = d.toString(); output += s; emitToUser(userId, 'agent:log', { agentId, type: 'output', content: s }); });
        child.stderr?.on('data', (d: Buffer) => { const s = d.toString(); output += s; emitToUser(userId, 'agent:log', { agentId, type: 'output', content: s }); });
        child.on('close', (code) => {
            if (!finished) { finished = true; clearTimeout(timer); resolve({ exitCode: code ?? -1, output }); }
        });
        child.on('error', (err) => {
            if (!finished) { finished = true; clearTimeout(timer); resolve({ exitCode: -1, output: err.message }); }
        });
    });
}

// Run a command via `sh -c` so shell operators (&&, ||, |, ;) work correctly
function streamShell(
    command: string,
    userId: string,
    agentId: string,
    timeout = 300_000
): Promise<{ exitCode: number; output: string }> {
    emitToUser(userId, 'agent:log', { agentId, type: 'command', content: command });
    return streamCommand('sh', ['-c', command], userId, agentId, timeout);
}

// ── Find and stop containers using a given host port ─────────────────────────

function stopContainersOnPort(port: number): void {
    try {
        const raw = execSync(
            `docker ps -q --filter publish=${port}`,
            { stdio: 'pipe', timeout: 5_000 }
        ).toString().trim();
        if (raw) {
            raw.split('\n').filter(Boolean).forEach(id => {
                try { execSync(`docker rm -f ${id.trim()}`, { stdio: 'pipe', timeout: 10_000 }); } catch { /* ignore */ }
            });
        }
    } catch { /* ignore */ }
}

// ── Plan executor ────────────────────────────────────────────────────────────

async function executeAgentPlan(userId: string, agentId: string, plan: ActionPlan): Promise<void> {
    for (const step of plan.steps) {

        // ── message ──────────────────────────────────────────────────────────
        if (step.type === 'message') {
            emitToUser(userId, 'agent:log', { agentId, type: 'ai', content: step.content });
            await new Promise(r => setTimeout(r, 60));
            continue;
        }

        // ── docker_pull ──────────────────────────────────────────────────────
        if (step.type === 'docker_pull') {
            emitToUser(userId, 'agent:log', { agentId, type: 'command', content: `docker pull ${step.image}` });
            const res = await streamCommand('docker', ['pull', step.image], userId, agentId);
            if (res.exitCode !== 0) {
                emitToUser(userId, 'agent:log', { agentId, type: 'error', content: `Failed to pull image "${step.image}".` });
                emitToUser(userId, 'agent:done', { agentId, success: false, summary: `Failed to pull ${step.image}` });
                return;
            }
            emitToUser(userId, 'agent:log', { agentId, type: 'success', content: `Image pulled: ${step.image}` });
            continue;
        }

        // ── docker_stop ──────────────────────────────────────────────────────
        if (step.type === 'docker_stop') {
            emitToUser(userId, 'agent:log', { agentId, type: 'command', content: `docker stop ${step.container}` });
            const res = await streamCommand('docker', ['stop', step.container], userId, agentId);
            if (res.exitCode !== 0 && !step.continueOnError) {
                emitToUser(userId, 'agent:log', { agentId, type: 'error', content: `Failed to stop "${step.container}".` });
                emitToUser(userId, 'agent:done', { agentId, success: false, summary: `Failed to stop ${step.container}` });
                return;
            }
            if (res.exitCode === 0) {
                emitToUser(userId, 'agent:log', { agentId, type: 'success', content: `Container stopped: ${step.container}` });
            }
            continue;
        }

        // ── docker_remove ────────────────────────────────────────────────────
        if (step.type === 'docker_remove') {
            emitToUser(userId, 'agent:log', { agentId, type: 'command', content: `docker rm -f ${step.container}` });
            const res = await streamCommand('docker', ['rm', '-f', step.container], userId, agentId);
            if (res.exitCode !== 0 && !step.continueOnError) {
                emitToUser(userId, 'agent:log', { agentId, type: 'error', content: `Failed to remove "${step.container}".` });
                emitToUser(userId, 'agent:done', { agentId, success: false, summary: `Failed to remove ${step.container}` });
                return;
            }
            if (res.exitCode === 0) {
                emitToUser(userId, 'agent:log', { agentId, type: 'success', content: `Container removed: ${step.container}` });
            }
            continue;
        }

        // ── docker_free_port ─────────────────────────────────────────────────
        if (step.type === 'docker_free_port') {
            emitToUser(userId, 'agent:log', { agentId, type: 'command', content: `Freeing port ${step.port}` });
            stopContainersOnPort(step.port);
            emitToUser(userId, 'agent:log', { agentId, type: 'info', content: `Port ${step.port} is now free.` });
            continue;
        }

        // ── docker_run ───────────────────────────────────────────────────────
        if (step.type === 'docker_run') {
            const cmd = `docker run ${step.args.join(' ')}`;
            emitToUser(userId, 'agent:log', { agentId, type: 'command', content: cmd });

            let res = await streamCommand('docker', ['run', ...step.args], userId, agentId);

            // Auto-recover: container name conflict → rm and retry
            if (res.exitCode !== 0 && res.output.includes('already in use')) {
                const nameIdx = step.args.indexOf('--name');
                if (nameIdx !== -1 && step.args[nameIdx + 1]) {
                    const name = step.args[nameIdx + 1];
                    emitToUser(userId, 'agent:log', { agentId, type: 'info', content: `Container "${name}" already exists — removing…` });
                    await streamCommand('docker', ['rm', '-f', name], userId, agentId);
                    res = await streamCommand('docker', ['run', ...step.args], userId, agentId);
                }
            }

            // Auto-recover: port conflict → free port and retry
            if (res.exitCode !== 0 && res.output.includes('port is already allocated')) {
                const portMatches = step.args.filter(a => /^\d+:\d+$/.test(a));
                const hostPorts = portMatches.map(p => parseInt(p.split(':')[0]));
                if (hostPorts.length > 0) {
                    emitToUser(userId, 'agent:log', { agentId, type: 'info', content: `Port conflict — freeing ports: ${hostPorts.join(', ')}` });
                    hostPorts.forEach(p => stopContainersOnPort(p));
                    await new Promise(r => setTimeout(r, 1500));
                    res = await streamCommand('docker', ['run', ...step.args], userId, agentId);
                }
            }

            if (res.exitCode !== 0) {
                emitToUser(userId, 'agent:log', { agentId, type: 'error', content: `Failed to start container. Exit code: ${res.exitCode}` });
                emitToUser(userId, 'agent:done', { agentId, success: false, summary: 'Container start failed' });
                return;
            }
            emitToUser(userId, 'agent:log', { agentId, type: 'success', content: `Container started successfully` });
            continue;
        }

        // ── docker_exec ──────────────────────────────────────────────────────
        if (step.type === 'docker_exec') {
            const displayCmd = `docker exec ${step.container} ${step.command}`;
            emitToUser(userId, 'agent:log', { agentId, type: 'command', content: displayCmd });
            // Execute via sh -c so the inner command isn't split on spaces
            const res = await streamCommand('docker', ['exec', step.container, 'sh', '-c', step.command], userId, agentId);
            if (res.exitCode !== 0) {
                const msg = `Command failed inside container "${step.container}" (exit ${res.exitCode}).`;
                emitToUser(userId, 'agent:log', { agentId, type: 'error', content: msg });
                if (!step.continueOnError) {
                    emitToUser(userId, 'agent:done', { agentId, success: false, summary: msg });
                    return;
                }
            } else {
                emitToUser(userId, 'agent:log', { agentId, type: 'success', content: `Command succeeded in "${step.container}"` });
            }
            continue;
        }

        // ── docker_logs ──────────────────────────────────────────────────────
        if (step.type === 'docker_logs') {
            emitToUser(userId, 'agent:log', { agentId, type: 'command', content: `docker logs --tail 20 ${step.container}` });
            await new Promise(r => setTimeout(r, 1_200)); // brief wait for container to start
            await streamCommand('docker', ['logs', '--tail', '20', step.container], userId, agentId);
            continue;
        }

        // ── shell ────────────────────────────────────────────────────────────
        if (step.type === 'shell') {
            // Always run via `sh -c` — handles &&, ||, |, ;, $(...) etc.
            const res = await streamShell(step.command, userId, agentId);
            if (res.exitCode !== 0) {
                const msg = `Shell command failed (exit ${res.exitCode}): ${step.command}`;
                emitToUser(userId, 'agent:log', { agentId, type: 'error', content: msg });
                if (!step.continueOnError) {
                    emitToUser(userId, 'agent:done', { agentId, success: false, summary: msg });
                    return;
                }
            }
            continue;
        }
    }

    emitToUser(userId, 'agent:done', { agentId, success: true, summary: plan.summary });
}

// ── Install Docker on host ────────────────────────────────────────────────────

async function installDockerOnHost(userId: string, agentId: string): Promise<void> {
    emitToUser(userId, 'agent:log', { agentId, type: 'info', content: 'Starting Docker installation on host...' });

    const script = 'curl -fsSL https://get.docker.com | sh && systemctl enable docker && systemctl start docker';
    emitToUser(userId, 'agent:log', { agentId, type: 'command', content: 'curl -fsSL https://get.docker.com | sh' });

    let succeeded = false;

    // Attempt 1: get.docker.com
    const m1 = spawn('nsenter', ['-t','1','-m','-u','-i','-n','-p','--','sh','-c', script], { stdio: ['ignore','pipe','pipe'] });
    await new Promise<void>((resolve) => {
        m1.stdout?.on('data', (d: Buffer) => emitToUser(userId, 'agent:log', { agentId, type: 'output', content: d.toString() }));
        m1.stderr?.on('data', (d: Buffer) => emitToUser(userId, 'agent:log', { agentId, type: 'output', content: d.toString() }));
        m1.on('close', (code) => { succeeded = code === 0; resolve(); });
        m1.on('error', () => resolve());
    });

    if (!succeeded) {
        // Attempt 2: apt-get
        emitToUser(userId, 'agent:log', { agentId, type: 'info', content: 'Trying apt-get fallback...' });
        emitToUser(userId, 'agent:log', { agentId, type: 'command', content: 'apt-get install -y docker.io' });
        const m2 = spawn('nsenter', ['-t','1','-m','-u','-i','-n','-p','--','sh','-c',
            'apt-get update -qq && apt-get install -y docker.io && systemctl enable docker && systemctl start docker',
        ], { stdio: ['ignore','pipe','pipe'] });
        await new Promise<void>((resolve) => {
            m2.stdout?.on('data', (d: Buffer) => emitToUser(userId, 'agent:log', { agentId, type: 'output', content: d.toString() }));
            m2.stderr?.on('data', (d: Buffer) => emitToUser(userId, 'agent:log', { agentId, type: 'output', content: d.toString() }));
            m2.on('close', (code) => { succeeded = code === 0; resolve(); });
            m2.on('error', () => resolve());
        });
    }

    if (succeeded) {
        emitToUser(userId, 'agent:log', { agentId, type: 'success', content: 'Docker installed and started.' });
        emitToUser(userId, 'agent:done', { agentId, success: true, summary: 'Docker installed' });
    } else {
        emitToUser(userId, 'agent:log', {
            agentId, type: 'error',
            content: 'Automatic Docker installation failed.\nManual install: https://docs.docker.com/engine/install/',
        });
        emitToUser(userId, 'agent:done', { agentId, success: false, summary: 'Docker installation failed' });
    }
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.post('/run', authenticateToken, async (req, res) => {
    const { message, agentId } = req.body || {};
    if (!message || typeof message !== 'string') {
        return res.status(400).json({ message: 'A message is required.' });
    }

    const userId = getUserId(req);
    const id     = (typeof agentId === 'string' && agentId) ? agentId
                    : `ag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const apiKey = await getSetting('nvidia_api_key');
    if (!apiKey) {
        return res.status(400).json({ configured: false, message: 'AI not configured. Set up your NVIDIA API key first.' });
    }
    const model = (await getSetting('nvidia_model')) || NVIDIA_DEFAULT_MODEL;

    try {
        emitToUser(userId, 'agent:log', { agentId: id, type: 'thinking', content: 'Analysing request and checking running containers…' });

        const plan = await planWithAI(message, apiKey, model);

        if (plan.requiresDocker && !isDockerAvailable()) {
            emitToUser(userId, 'agent:log', {
                agentId: id, type: 'docker_missing',
                content: `Docker is not installed. I need it to "${plan.summary}". Would you like me to install Docker automatically?`,
            });
            emitToUser(userId, 'agent:done', { agentId: id, success: false, summary: 'Docker required', dockerMissing: true });
            return res.json({ agentId: id, dockerMissing: true, summary: plan.summary });
        }

        res.json({ agentId: id, started: true, summary: plan.summary });

        setImmediate(() => {
            executeAgentPlan(userId, id, plan).catch(err => {
                emitToUser(userId, 'agent:log', { agentId: id, type: 'error', content: `Agent error: ${err.message}` });
                emitToUser(userId, 'agent:done', { agentId: id, success: false, summary: 'Agent crashed' });
            });
        });
    } catch (err: any) {
        const upstreamStatus: number = err?.status || 500;
        let clientStatus = upstreamStatus >= 100 && upstreamStatus < 600 ? upstreamStatus : 500;
        let errMsg = err?.message || 'Agent failed';
        if (upstreamStatus === 401 || upstreamStatus === 403) {
            clientStatus = 400;
            errMsg = 'AI API key is invalid or expired. Please update it in AI settings.';
        }
        return res.status(clientStatus).json({ message: errMsg });
    }
});

router.post('/install-docker', authenticateToken, async (req, res) => {
    const { agentId } = req.body || {};
    const userId = getUserId(req);
    const id     = (typeof agentId === 'string' && agentId) ? agentId : `ag_docker_${Date.now()}`;

    res.json({ agentId: id, started: true });

    setImmediate(() => {
        installDockerOnHost(userId, id).catch(err => {
            emitToUser(userId, 'agent:log', { agentId: id, type: 'error', content: `Installation crashed: ${err.message}` });
            emitToUser(userId, 'agent:done', { agentId: id, success: false, summary: 'Docker install failed' });
        });
    });
});

export default router;
