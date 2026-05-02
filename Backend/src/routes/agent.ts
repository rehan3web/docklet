import express from 'express';
import { spawn, execSync } from 'child_process';
import OpenAI from 'openai';
import { authenticateToken } from '../middleware/auth';
import { getSetting } from '../lib/settings';
import { emitToUser } from '../lib/socket';

const router = express.Router();

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_DEFAULT_MODEL = 'openai/gpt-oss-120b';

function getUserId(req: any): string {
    const u = req.user;
    return String(u?.id ?? u?.username ?? 'anonymous');
}

function isDockerAvailable(): boolean {
    try {
        execSync('docker info', { stdio: 'pipe', timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

type AgentStep =
    | { type: 'message'; content: string }
    | { type: 'shell'; command: string; description: string }
    | { type: 'docker_pull'; image: string; description: string }
    | { type: 'docker_run'; args: string[]; description: string }
    | { type: 'docker_logs'; container: string; description: string };

type ActionPlan = {
    requiresDocker: boolean;
    summary: string;
    steps: AgentStep[];
};

const AGENT_SYSTEM_PROMPT = `You are a DevOps automation agent inside Docklet, a Docker/VPS management dashboard.
Given a user request, generate a JSON action plan to accomplish it with Docker.

RULES:
- Use official Docker Hub images, pin to stable tags (e.g. redis:7, postgres:16, nginx:alpine)
- For databases: expose default port, set required env vars (POSTGRES_PASSWORD, MYSQL_ROOT_PASSWORD, MONGO_INITDB_ROOT_USERNAME/PASSWORD etc.)
- Always add --restart=unless-stopped for persistent services
- Always use -d (detached) for long-running containers
- Container names: lowercase alphanumeric + hyphens (e.g. "my-redis")
- After docker_run, add docker_logs to show the container started correctly
- Wrap every plan in a message step at start and end

Respond ONLY with valid JSON (no markdown fences):
{
  "requiresDocker": true,
  "summary": "One-line summary",
  "steps": [
    { "type": "message", "content": "Installing Redis on port 6379..." },
    { "type": "docker_pull", "image": "redis:7", "description": "Pulling Redis image" },
    { "type": "docker_run", "args": ["-d","--name","redis","--restart=unless-stopped","-p","6379:6379","redis:7"], "description": "Starting Redis container" },
    { "type": "docker_logs", "container": "redis", "description": "Verifying container started" },
    { "type": "message", "content": "Redis is running on port 6379. Connect with: redis-cli -h localhost -p 6379" }
  ]
}

Step types:
- "message": Plain text shown as an AI message
- "docker_pull": Pull image { image: "name:tag" }
- "docker_run": Run container { args: [...] } — image name is the last element
- "docker_logs": Show last 20 lines of a running container { container: "name" }
- "shell": Run any shell command { command: "full command string" }`;

async function planWithAI(message: string, apiKey: string, model: string): Promise<ActionPlan> {
    const openai = new OpenAI({ apiKey, baseURL: NVIDIA_BASE_URL });

    const completion = await openai.chat.completions.create({
        model,
        messages: [
            { role: 'system', content: AGENT_SYSTEM_PROMPT },
            { role: 'user', content: message },
        ],
        temperature: 0.2,
        max_tokens: 2048,
    });

    const raw = (completion.choices?.[0]?.message?.content || '').trim();
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

function streamCommand(
    command: string,
    args: string[],
    userId: string,
    agentId: string,
    timeout = 300_000
): Promise<{ exitCode: number | null; output: string }> {
    return new Promise((resolve) => {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        let finished = false;

        const timer = setTimeout(() => {
            if (!finished) {
                try { child.kill('SIGKILL'); } catch { /* ignore */ }
                emitToUser(userId, 'agent:log', { agentId, type: 'error', content: '[Command timed out]' });
                resolve({ exitCode: -1, output });
            }
        }, timeout);

        child.stdout?.on('data', (data: Buffer) => {
            const chunk = data.toString();
            output += chunk;
            emitToUser(userId, 'agent:log', { agentId, type: 'output', content: chunk });
        });
        child.stderr?.on('data', (data: Buffer) => {
            const chunk = data.toString();
            output += chunk;
            emitToUser(userId, 'agent:log', { agentId, type: 'output', content: chunk });
        });
        child.on('close', (exitCode) => {
            if (!finished) {
                finished = true;
                clearTimeout(timer);
                resolve({ exitCode, output });
            }
        });
        child.on('error', (err) => {
            if (!finished) {
                finished = true;
                clearTimeout(timer);
                emitToUser(userId, 'agent:log', { agentId, type: 'error', content: `Spawn error: ${err.message}` });
                resolve({ exitCode: -1, output: err.message });
            }
        });
    });
}

async function executeAgentPlan(userId: string, agentId: string, plan: ActionPlan): Promise<void> {
    for (const step of plan.steps) {
        if (step.type === 'message') {
            emitToUser(userId, 'agent:log', { agentId, type: 'ai', content: step.content });
            await new Promise(r => setTimeout(r, 80));
            continue;
        }

        if (step.type === 'docker_pull') {
            emitToUser(userId, 'agent:log', { agentId, type: 'command', content: `docker pull ${step.image}` });
            const result = await streamCommand('docker', ['pull', step.image], userId, agentId);
            if (result.exitCode !== 0) {
                emitToUser(userId, 'agent:log', { agentId, type: 'error', content: `❌ Failed to pull image "${step.image}" from Docker Hub.` });
                emitToUser(userId, 'agent:done', { agentId, success: false, summary: `Failed to pull ${step.image}` });
                return;
            }
            emitToUser(userId, 'agent:log', { agentId, type: 'success', content: `✓ Image pulled: ${step.image}` });
            continue;
        }

        if (step.type === 'docker_run') {
            const cmd = `docker run ${step.args.join(' ')}`;
            emitToUser(userId, 'agent:log', { agentId, type: 'command', content: cmd });
            let result = await streamCommand('docker', ['run', ...step.args], userId, agentId);

            if (result.exitCode !== 0) {
                // Try to clean up and retry (container name already in use)
                const nameIdx = step.args.indexOf('--name');
                if (nameIdx !== -1 && step.args[nameIdx + 1]) {
                    const containerName = step.args[nameIdx + 1];
                    emitToUser(userId, 'agent:log', { agentId, type: 'info', content: `Container "${containerName}" already exists — removing and retrying...` });
                    await streamCommand('docker', ['rm', '-f', containerName], userId, agentId);
                    result = await streamCommand('docker', ['run', ...step.args], userId, agentId);
                }
                if (result.exitCode !== 0) {
                    emitToUser(userId, 'agent:log', { agentId, type: 'error', content: `❌ Failed to start container.` });
                    emitToUser(userId, 'agent:done', { agentId, success: false, summary: 'Container start failed' });
                    return;
                }
            }
            emitToUser(userId, 'agent:log', { agentId, type: 'success', content: `✓ Container started successfully` });
            continue;
        }

        if (step.type === 'docker_logs') {
            emitToUser(userId, 'agent:log', { agentId, type: 'command', content: `docker logs --tail 20 ${step.container}` });
            await new Promise(r => setTimeout(r, 800)); // Brief pause so container can start
            await streamCommand('docker', ['logs', '--tail', '20', step.container], userId, agentId);
            continue;
        }

        if (step.type === 'shell') {
            emitToUser(userId, 'agent:log', { agentId, type: 'command', content: step.command });
            const parts = step.command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
            const unquoted = parts.map(p => p.replace(/^['"]|['"]$/g, ''));
            const result = await streamCommand(unquoted[0], unquoted.slice(1), userId, agentId);
            if (result.exitCode !== 0) {
                emitToUser(userId, 'agent:log', { agentId, type: 'error', content: `Command exited with code ${result.exitCode}` });
            }
            continue;
        }
    }

    emitToUser(userId, 'agent:done', { agentId, success: true, summary: plan.summary });
}

// ── Install Docker on host ─────────────────────────────────────────────────────

async function installDockerOnHost(userId: string, agentId: string): Promise<void> {
    emitToUser(userId, 'agent:log', { agentId, type: 'info', content: 'Starting Docker installation on host...' });

    // Attempt 1: get.docker.com script
    emitToUser(userId, 'agent:log', { agentId, type: 'command', content: 'curl -fsSL https://get.docker.com | sh' });
    const method1 = spawn('nsenter', [
        '-t', '1', '-m', '-u', '-i', '-n', '-p', '--',
        'sh', '-c', 'curl -fsSL https://get.docker.com | sh && systemctl enable docker && systemctl start docker',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let succeeded = false;
    await new Promise<void>((resolve) => {
        method1.stdout?.on('data', (d: Buffer) => emitToUser(userId, 'agent:log', { agentId, type: 'output', content: d.toString() }));
        method1.stderr?.on('data', (d: Buffer) => emitToUser(userId, 'agent:log', { agentId, type: 'output', content: d.toString() }));
        method1.on('close', (code) => { succeeded = code === 0; resolve(); });
        method1.on('error', () => resolve());
    });

    if (!succeeded) {
        // Attempt 2: apt-get
        emitToUser(userId, 'agent:log', { agentId, type: 'info', content: 'Trying alternative install method (apt-get)...' });
        emitToUser(userId, 'agent:log', { agentId, type: 'command', content: 'apt-get update && apt-get install -y docker.io' });
        const method2 = spawn('nsenter', [
            '-t', '1', '-m', '-u', '-i', '-n', '-p', '--',
            'sh', '-c', 'apt-get update -qq && apt-get install -y docker.io && systemctl enable docker && systemctl start docker',
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        await new Promise<void>((resolve) => {
            method2.stdout?.on('data', (d: Buffer) => emitToUser(userId, 'agent:log', { agentId, type: 'output', content: d.toString() }));
            method2.stderr?.on('data', (d: Buffer) => emitToUser(userId, 'agent:log', { agentId, type: 'output', content: d.toString() }));
            method2.on('close', (code) => { succeeded = code === 0; resolve(); });
            method2.on('error', () => resolve());
        });
    }

    if (succeeded) {
        emitToUser(userId, 'agent:log', { agentId, type: 'success', content: '✓ Docker installed and started successfully!' });
        emitToUser(userId, 'agent:done', { agentId, success: true, summary: 'Docker installed' });
    } else {
        emitToUser(userId, 'agent:log', {
            agentId, type: 'error',
            content: '❌ Automatic Docker installation failed. Please install manually:\nhttps://docs.docker.com/engine/install/',
        });
        emitToUser(userId, 'agent:done', { agentId, success: false, summary: 'Docker installation failed' });
    }
}

// ── Routes ─────────────────────────────────────────────────────────────────────

router.post('/run', authenticateToken, async (req, res) => {
    const { message, agentId } = req.body || {};
    if (!message || typeof message !== 'string') {
        return res.status(400).json({ message: 'A message is required.' });
    }

    const userId = getUserId(req);
    const id = (typeof agentId === 'string' && agentId) ? agentId : `ag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const apiKey = await getSetting('nvidia_api_key');
    if (!apiKey) {
        return res.status(400).json({
            configured: false,
            message: 'AI is not configured. Set up your NVIDIA API key first.',
        });
    }
    const model = (await getSetting('nvidia_model')) || NVIDIA_DEFAULT_MODEL;

    try {
        emitToUser(userId, 'agent:log', { agentId: id, type: 'thinking', content: 'Planning your request…' });

        const plan = await planWithAI(message, apiKey, model);

        if (plan.requiresDocker && !isDockerAvailable()) {
            emitToUser(userId, 'agent:log', {
                agentId: id, type: 'docker_missing',
                content: `Docker is not installed on this host. I need Docker to run "${plan.summary}". Would you like me to install Docker automatically?`,
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
    const id = (typeof agentId === 'string' && agentId) ? agentId : `ag_docker_${Date.now()}`;

    res.json({ agentId: id, started: true });

    setImmediate(() => {
        installDockerOnHost(userId, id).catch(err => {
            emitToUser(userId, 'agent:log', { agentId: id, type: 'error', content: `Installation crashed: ${err.message}` });
            emitToUser(userId, 'agent:done', { agentId: id, success: false, summary: 'Docker install failed' });
        });
    });
});

export default router;
