import express from 'express';
import { spawn, execSync } from 'child_process';
import OpenAI from 'openai';
import { authenticateToken } from '../middleware/auth';
import { getSetting } from '../lib/settings';
import { emitToUser } from '../lib/socket';
import { getConnection } from '../lib/db';

const router = express.Router();

const NVIDIA_BASE_URL      = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_DEFAULT_MODEL = 'openai/gpt-oss-120b';
const AI_CALL_DELAY_MS     = 1500;   // min gap between AI API calls
const MAX_VERIFY_CYCLES    = 3;      // max Plan→Execute→Verify loops
const MAX_WAIT_MS          = 30_000; // cap on any single "wait" step
const MAX_STEPS_PER_PLAN   = 20;     // cap total steps per plan/fix
const MAX_FIX_STEPS        = 15;     // cap fix steps from evaluation AI
const LOOP_TIMEOUT_MS      = 10 * 60 * 1000; // 10-minute hard stop

// ── Cancellation registry ─────────────────────────────────────────────────────
const cancelledAgents = new Set<string>();

function cancelAgent(agentId: string): void { cancelledAgents.add(agentId); }
function isCancelled(agentId: string): boolean { return cancelledAgents.has(agentId); }
function clearCancel(agentId: string): void { cancelledAgents.delete(agentId); }

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function getUserId(req: any): string {
    return String(req.user?.id ?? req.user?.username ?? 'anonymous');
}

function isDockerAvailable(): boolean {
    try { execSync('docker info', { stdio: 'pipe', timeout: 5_000 }); return true; }
    catch { return false; }
}

async function getDomainContext(): Promise<string> {
    try {
        const db = await getConnection();

        // Proxy domains (with port mapping, verification, SSL status)
        const proxy = await db.query(
            `SELECT domain, target_port, verified, ssl_enabled FROM docklet_proxy_domains ORDER BY created_at DESC LIMIT 20`
        );

        // Verified base domains (wildcard DNS coverage)
        let baseDomains: string[] = [];
        try {
            const base = await db.query(
                `SELECT domain, vps_ip FROM verified_domains WHERE verified = TRUE ORDER BY created_at DESC LIMIT 20`
            );
            baseDomains = base.rows.map((r: any) => `  - ${r.domain} (IP: ${r.vps_ip}) — wildcard DNS covers *.${r.domain}`);
        } catch { /* table may not exist yet */ }

        const parts: string[] = [];
        if (baseDomains.length) {
            parts.push('Verified base domains (wildcard A * record — ALL subdomains resolve automatically):\n' + baseDomains.join('\n'));
        }
        if (proxy.rows.length) {
            parts.push('Configured proxy entries:\n' + proxy.rows.map((r: any) =>
                `  - ${r.domain} → port ${r.target_port} | verified: ${r.verified} | ssl: ${r.ssl_enabled}`
            ).join('\n'));
        }
        return parts.length ? parts.join('\n\n') : 'No domains configured.';
    } catch { return 'Could not fetch domain list (DB unavailable).'; }
}

function getDockerContext(): string {
    try {
        const out = execSync(
            'docker ps -a --format "{{.Names}}|{{.Status}}|{{.Ports}}|{{.Image}}"',
            { stdio: 'pipe', timeout: 5_000 }
        ).toString().trim();
        if (!out) return 'No containers currently exist.';
        return 'Current containers:\n' + out.split('\n').map(line => {
            const [name, status, ports, image] = line.split('|');
            return `  - ${name} (${image}) [${status}] ports: ${ports || 'none'}`;
        }).join('\n');
    } catch { return 'Unable to fetch container list.'; }
}

function getNginxContext(): string {
    try {
        const out = execSync(
            'docker exec docklet-nginx ls /etc/nginx/conf.d/',
            { stdio: 'pipe', timeout: 5_000 }
        ).toString().trim();
        if (!out) return 'Nginx conf.d is empty.';
        return 'Nginx conf.d files: ' + out.split('\n').filter(Boolean).join(', ');
    } catch { return 'Nginx context unavailable (nginx may not be running).'; }
}

// ── SSL helpers (mirrored from proxy.ts so agent can enable SSL inline) ───────

const NGINX_CONFIGS_DIR_AGENT = require('path').join(process.cwd(), 'nginx-configs');
const NGINX_CONTAINER_AGENT   = process.env.NGINX_CONTAINER_NAME || 'docklet-nginx';
const SELF_CONTAINER_AGENT    = process.env.SELF_CONTAINER_NAME  || 'docklet-server';

function isRootDomain(domain: string): boolean { return domain.split('.').length === 2; }
function sslServerNames(domain: string): string { return isRootDomain(domain) ? `${domain} www.${domain}` : domain; }
function sslDomainArgs(domain: string): string[] {
    return (isRootDomain(domain) ? [domain, `www.${domain}`] : [domain]).flatMap(d => ['-d', d]);
}

async function getAgentServerIp(): Promise<string> {
    try { const r = await fetch('https://api.ipify.org?format=json'); return ((await r.json()) as any).ip; }
    catch { return 'YOUR_SERVER_IP'; }
}

function nginxHttpsConfig(domain: string, port: number, serverIp: string): string {
    const names = sslServerNames(domain);
    return `# Managed by Docklet Agent
server { listen 80; server_name ${names};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}
server { listen 443 ssl http2; server_name ${names};
    ssl_certificate     /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    location / {
        proxy_pass http://${serverIp}:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;
}

async function agentEnableSsl(
    domain: string, userId: string, agentId: string, logLines: string[]
): Promise<{ success: boolean; url?: string }> {
    const fs   = require('fs');
    const path = require('path');
    const db   = await getConnection();
    const { rows } = await db.query('SELECT * FROM docklet_proxy_domains WHERE domain = $1', [domain]);
    const row = rows[0];
    if (!row) return { success: false };
    if (!row.verified) return { success: false };
    if (row.ssl_enabled) return { success: true, url: `https://${domain}` };

    emitToUser(userId, 'agent:log', { agentId, type: 'info', content: `Running certbot for ${domain}…` });

    const certOk = await new Promise<boolean>((resolve) => {
        const child = spawn('docker', [
            'run', '--rm', '--volumes-from', SELF_CONTAINER_AGENT,
            'certbot/certbot', 'certonly',
            '--webroot', '-w', '/var/www/certbot',
            '--non-interactive', '--agree-tos',
            '--email', `admin@${domain}`,
            ...sslDomainArgs(domain),
        ]);
        let out = '';
        child.stdout.on('data', (d: Buffer) => { out += d.toString(); logLines.push(d.toString()); emitToUser(userId, 'agent:log', { agentId, type: 'output', content: d.toString().trim() }); });
        child.stderr.on('data', (d: Buffer) => { out += d.toString(); logLines.push(d.toString()); });
        child.on('error', () => resolve(false));
        child.on('close', (code: number) => resolve(code === 0));
    });

    if (!certOk) return { success: false };

    const serverIp = await getAgentServerIp();
    if (!fs.existsSync(NGINX_CONFIGS_DIR_AGENT)) fs.mkdirSync(NGINX_CONFIGS_DIR_AGENT, { recursive: true });
    fs.writeFileSync(path.join(NGINX_CONFIGS_DIR_AGENT, `${domain}.conf`), nginxHttpsConfig(domain, row.target_port, serverIp));

    await new Promise<void>((resolve) => {
        const child = spawn('docker', ['exec', NGINX_CONTAINER_AGENT, 'nginx', '-s', 'reload']);
        child.on('close', () => resolve()); child.on('error', () => resolve());
    });

    await db.query('UPDATE docklet_proxy_domains SET ssl_enabled = TRUE, updated_at = NOW() WHERE domain = $1', [domain]);
    return { success: true, url: `https://${domain}` };
}

function stopContainersOnPort(port: number): void {
    try {
        const ids = execSync(`docker ps -q --filter publish=${port}`, { stdio: 'pipe', timeout: 5_000 })
            .toString().trim().split('\n').filter(Boolean);
        ids.forEach(id => { try { execSync(`docker rm -f ${id.trim()}`, { stdio: 'pipe', timeout: 10_000 }); } catch { /* ignore */ } });
    } catch { /* ignore */ }
}

// ── Step types ────────────────────────────────────────────────────────────────

type AgentStep =
    | { type: 'message';        content: string }
    | { type: 'wait';           ms: number; description: string }
    | { type: 'shell';          command: string; description: string; continueOnError?: boolean }
    | { type: 'docker_pull';    image: string; description: string }
    | { type: 'docker_run';     args: string[]; description: string }
    | { type: 'docker_exec';    container: string; command: string; description: string; continueOnError?: boolean }
    | { type: 'docker_stop';    container: string; description: string; continueOnError?: boolean }
    | { type: 'docker_remove';  container: string; description: string; continueOnError?: boolean }
    | { type: 'docker_logs';    container: string; description: string }
    | { type: 'docker_free_port'; port: number; description: string }
    | { type: 'proxy_enable_ssl';    domain: string; description: string }
    | { type: 'proxy_create_domain'; domain: string; targetPort: number; description: string };

type ActionPlan = {
    requiresDocker: boolean;
    summary: string;
    steps: AgentStep[];
};

type EvalResult = {
    ok: boolean;
    assessment: string;
    fixSteps: AgentStep[];
};

// ── System prompts ────────────────────────────────────────────────────────────

const PLAN_SYSTEM_PROMPT = `You are an advanced DevOps automation agent inside Docklet (Docker/VPS management dashboard).

Given a user request and LIVE DOCKER CONTEXT, output a JSON action plan.

RULES:
1. Check live context — if a container/port is already in use, stop/remove it first.
2. NEVER use shell operators (||, &&, |) in a "shell" step — use separate steps.
3. MongoDB 7+: use "mongosh" NOT "mongo" for exec commands.
4. Redeploy: stop old container → free port → pull → run.
5. Use docker_exec for in-container operations (password changes, config, etc.).
6. Use docker_free_port to release a port before binding it.
7. Use "wait" to pause (e.g. wait 3000ms after starting MongoDB before pinging it).
8. Container names: lowercase alphanumeric + hyphens only.
9. Always use --restart=unless-stopped and -d for persistent services.

ENVIRONMENT CONSTRAINTS (this host is a shared/containerized Linux environment):
- NEVER use --sysctl flags in docker run — they are blocked (e.g. vm.overcommit_memory, net.core.*). Drop them silently.
- NEVER use --privileged or --cap-add SYS_ADMIN — not allowed.
- NEVER use --network host — use explicit -p port mappings instead.
- Redis: run WITHOUT --sysctl; add --loglevel warning to suppress the overcommit warning. Redis works fine without it.
- Elasticsearch/OpenSearch: set -e "discovery.type=single-node" and -e "xpack.security.enabled=false" instead of kernel tweaks.
- If a previous attempt failed with "not allowed", "operation not permitted", or "invalid argument" for a flag, OMIT that flag entirely — do not retry it.

PER-SERVICE INSTALL RECIPES (always use these exact patterns):
- Redis:      docker run -d --name redis --restart=unless-stopped -p 6379:6379 redis:7-alpine --loglevel warning
              Verify: docker exec redis redis-cli ping  (expect: PONG)
- MySQL:      docker run -d --name mysql --restart=unless-stopped -p 3306:3306 -e MYSQL_ROOT_PASSWORD=<password> mysql:8
              Wait 15s before verify. Verify: docker exec mysql mysqladmin -uroot -p<password> ping
              NEVER use mysqladmin status for health check — use ping.
- PostgreSQL: docker run -d --name postgres --restart=unless-stopped -p 5432:5432 -e POSTGRES_PASSWORD=<password> postgres:16-alpine
              Wait 5s. Verify: docker exec postgres pg_isready -U postgres
- MongoDB:    docker run -d --name mongodb --restart=unless-stopped -p 27017:27017 mongo:7
              Wait 5s. Verify: docker exec mongodb mongosh --eval "db.runCommand({ping:1})" --quiet
- Nginx:      docker run -d --name nginx --restart=unless-stopped -p 80:80 -p 443:443 nginx:alpine
              Verify: docker exec nginx nginx -t
- RabbitMQ:   docker run -d --name rabbitmq --restart=unless-stopped -p 5672:5672 -p 15672:15672 rabbitmq:3-management-alpine
              Wait 10s. Verify: docker exec rabbitmq rabbitmq-diagnostics -q ping
- Memcached:  docker run -d --name memcached --restart=unless-stopped -p 11211:11211 memcached:alpine
- MariaDB:    docker run -d --name mariadb --restart=unless-stopped -p 3306:3306 -e MYSQL_ROOT_PASSWORD=<password> mariadb:11
              Wait 10s. Verify: docker exec mariadb mysqladmin -uroot -p<password> ping
- Valkey:     docker run -d --name valkey --restart=unless-stopped -p 6379:6379 valkey/valkey:alpine --loglevel warning
              Verify: docker exec valkey valkey-cli ping
- Minio:      docker run -d --name minio --restart=unless-stopped -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=admin -e MINIO_ROOT_PASSWORD=<password> minio/minio server /data --console-address ":9001"
- Gitea:      docker run -d --name gitea --restart=unless-stopped -p 3000:3000 -p 222:22 gitea/gitea:latest
- WordPress:  docker run -d --name wordpress --restart=unless-stopped -p 8080:80 -e WORDPRESS_DB_HOST=mysql -e WORDPRESS_DB_USER=root -e WORDPRESS_DB_PASSWORD=<password> -e WORDPRESS_DB_NAME=wordpress wordpress:latest
- Grafana:    docker run -d --name grafana --restart=unless-stopped -p 3000:3000 grafana/grafana:latest
- InfluxDB:   docker run -d --name influxdb --restart=unless-stopped -p 8086:8086 influxdb:2
- Prometheus: docker run -d --name prometheus --restart=unless-stopped -p 9090:9090 prom/prometheus:latest
- n8n:        docker run -d --name n8n --restart=unless-stopped -p 5678:5678 n8nio/n8n:latest
- Uptime Kuma: docker run -d --name uptime-kuma --restart=unless-stopped -p 3001:3001 louislam/uptime-kuma:1

For any service not listed above, use the official Docker Hub image with sensible defaults (latest stable tag, standard port, --restart=unless-stopped, -d).

DOMAIN & SSL AUTOMATION:
- You receive a DOMAIN CONTEXT with two sections:
  A) "Verified base domains" — base domains whose wildcard A record (* → IP) is confirmed. Every subdomain of these automatically resolves — no extra DNS step needed.
  B) "Configured proxy entries" — domains/subdomains already registered in the reverse proxy.

- WILDCARD RULE: If the user asks to connect "sub.base.tld" and "base.tld" appears in section A (wildcard verified), then "sub.base.tld" is ALREADY resolvable. Do NOT tell the user to go verify DNS. Proceed directly.

- Decision tree for domain/SSL requests:
  1. Check section B. If the exact domain IS already in the proxy:
     - verified=true, ssl_enabled=false → "proxy_enable_ssl" step only.
     - ssl_enabled=true → "message" step: SSL already active, URL is https://<domain>.
  2. If the domain is NOT in section B but its parent base domain IS in section A (wildcard):
     - Use "proxy_create_domain" to register the subdomain in the proxy (this writes the nginx config and DB entry).
     - Then use "proxy_enable_ssl" to issue the certificate.
     - Output the final https:// URL.
  3. If neither condition is met → "message" step: "Please go to Domain, click Add Domain, and verify it first."
- To find the target port for a container: look it up in the LIVE DOCKER CONTEXT (the host port in the ports column).
- The nginx container name is "docklet-nginx".

STEP TYPES:
- "message": { "content": "..." }
- "wait": { "ms": 3000, "description": "Wait for service to initialize" }
- "docker_pull": { "image": "name:tag", "description": "..." }
- "docker_run": { "args": [...], "description": "..." }  — image is last arg
- "docker_exec": { "container": "name", "command": "mongosh admin --eval \\"...\\"", "description": "...", "continueOnError": false }
- "docker_stop": { "container": "name", "description": "...", "continueOnError": true }
- "docker_remove": { "container": "name", "description": "...", "continueOnError": true }
- "docker_free_port": { "port": 27017, "description": "..." }
- "docker_logs": { "container": "name", "description": "..." }
- "shell": { "command": "single-command-no-operators", "description": "...", "continueOnError": false }
- "proxy_create_domain": { "domain": "client.example.com", "targetPort": 3000, "description": "Register subdomain in reverse proxy" }
- "proxy_enable_ssl": { "domain": "example.com", "description": "Issue SSL certificate via Let's Encrypt" }

Respond ONLY with valid JSON — no markdown fences, no extra text:
{ "requiresDocker": true, "summary": "...", "steps": [...] }`;

const EVAL_SYSTEM_PROMPT = `You are verifying whether a DevOps task succeeded.

You will receive:
1. The original user request
2. The full execution log (all commands + their output)
3. The current live Docker state

Your job: determine if the task genuinely succeeded (service running, healthy, accessible).

Rules:
- A container being "Up" is not enough — check if the service is actually working.
- EXCEPTION: If the original request is purely to CHECK or REPORT status/health (e.g. "check health", "what is the status", "is it running", "show me the logs"), then a container showing "Up" in docker ps IS sufficient to set ok=true. Do not demand an HTTP curl for pure status-check requests.
- If fixSteps are needed, make them precise. Use "wait" before retrying health checks.
- MongoDB 7+: use "mongosh" not "mongo".
- NEVER make unnecessary changes — only fix what is actually broken.
- If ok=true, fixSteps must be an empty array.

CRITICAL FIX RULES (read carefully before generating fixSteps):
- If a command failed with "not allowed", "invalid argument", "operation not permitted", or "permission denied" for a specific flag or sysctl, that flag is BLOCKED on this host. NEVER include it in fixSteps — omit it entirely.
- --sysctl flags (e.g. vm.overcommit_memory) are NEVER allowed on this host. Do not use them.
- --privileged and --cap-add SYS_ADMIN are NOT allowed on this host.
- --network host is NOT allowed — use -p port mappings instead.
- Redis: if vm.overcommit_memory was blocked, fix by running Redis WITHOUT any --sysctl, adding --loglevel warning instead. Redis works correctly without kernel tweaks.
- Elasticsearch/OpenSearch: use -e "discovery.type=single-node" instead of kernel vm.max_map_count changes.
- If the SAME command failed in multiple prior attempts, do NOT retry it — use a different approach entirely.
- Only generate fixSteps you are confident will succeed given the above constraints.

PROXY/DOMAIN/SSL VERIFICATION RULES (very important):
- The execution log will contain lines like "[ok] Proxy entry created: <domain> → port <N>" and "[ok] SSL enabled for <domain>". If BOTH of these appear in the log without subsequent errors, the domain is fully configured — set ok=true immediately.
- The NGINX CONF.D FILES list shows which config files exist inside the nginx container. If "<domain>.conf" appears there, the nginx config was written successfully.
- Do NOT conclude "domain not routed" based solely on docker ps output — docker ps cannot show nginx routing. Use the execution log and the nginx conf.d file list instead.
- If the log shows "Proxy entry created" and the nginx conf.d list shows the domain's .conf file, the proxy IS configured correctly. Set ok=true.
- NEVER generate fixSteps that repeat proxy_create_domain or proxy_enable_ssl if those already appear with "[ok]" in the execution log.

Respond ONLY with valid JSON — no markdown, no extra text:
{
  "ok": true,
  "assessment": "One sentence: what you found",
  "fixSteps": []
}
OR:
{
  "ok": false,
  "assessment": "One sentence: what is wrong and why",
  "fixSteps": [ ...same step types as action plan... ]
}`;

// ── AI calls ──────────────────────────────────────────────────────────────────

function makeOpenAI(apiKey: string): OpenAI {
    return new OpenAI({ apiKey, baseURL: NVIDIA_BASE_URL });
}

async function planWithAI(message: string, apiKey: string, model: string): Promise<ActionPlan> {
    const context      = isDockerAvailable() ? getDockerContext() : 'Docker is not available.';
    const domainCtx    = await getDomainContext();
    const userPrompt   = `LIVE DOCKER CONTEXT:\n${context}\n\nDOMAIN CONTEXT:\n${domainCtx}\n\nUSER REQUEST: ${message}`;

    const res = await makeOpenAI(apiKey).chat.completions.create({
        model,
        messages: [
            { role: 'system', content: PLAN_SYSTEM_PROMPT },
            { role: 'user',   content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens:  3072,
    });

    const raw     = (res.choices?.[0]?.message?.content || '').trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try { return JSON.parse(cleaned); }
    catch {
        return { requiresDocker: false, summary: 'AI response', steps: [{ type: 'message', content: cleaned }] };
    }
}

async function evaluateWithAI(
    originalRequest: string,
    executionLog: string,
    apiKey: string,
    model: string
): Promise<EvalResult> {
    const context    = isDockerAvailable() ? getDockerContext() : 'Docker is not available.';
    const nginxCtx   = getNginxContext();
    const userPrompt =
        `ORIGINAL REQUEST: ${originalRequest}\n\n` +
        `EXECUTION LOG:\n${executionLog.slice(-6000)}\n\n` +
        `CURRENT DOCKER STATE:\n${context}\n\n` +
        `NGINX CONF.D FILES:\n${nginxCtx}`;

    const res = await makeOpenAI(apiKey).chat.completions.create({
        model,
        messages: [
            { role: 'system', content: EVAL_SYSTEM_PROMPT },
            { role: 'user',   content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens:  2048,
    });

    const raw     = (res.choices?.[0]?.message?.content || '').trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try {
        const parsed = JSON.parse(cleaned);
        return {
            ok:         Boolean(parsed.ok),
            assessment: String(parsed.assessment || ''),
            fixSteps:   Array.isArray(parsed.fixSteps) ? parsed.fixSteps : [],
        };
    } catch {
        return { ok: false, assessment: 'Could not parse AI evaluation.', fixSteps: [] };
    }
}

// ── Command streaming ─────────────────────────────────────────────────────────

function streamCommand(
    command: string,
    args: string[],
    userId: string,
    agentId: string,
    logCollector: string[],
    timeout = 300_000
): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve) => {
        const child  = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let output   = '';
        let finished = false;

        const timer = setTimeout(() => {
            if (!finished) {
                try { child.kill('SIGKILL'); } catch { /* ignore */ }
                const msg = '[Command timed out]';
                emitToUser(userId, 'agent:log', { agentId, type: 'error', content: msg });
                logCollector.push(msg);
                resolve({ exitCode: -1, output });
            }
        }, timeout);

        const onData = (d: Buffer) => {
            const s = d.toString();
            output += s;
            logCollector.push(s);
            emitToUser(userId, 'agent:log', { agentId, type: 'output', content: s });
        };

        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('close', (code) => {
            if (!finished) { finished = true; clearTimeout(timer); resolve({ exitCode: code ?? -1, output }); }
        });
        child.on('error', (err) => {
            if (!finished) {
                finished = true; clearTimeout(timer);
                logCollector.push(err.message);
                resolve({ exitCode: -1, output: err.message });
            }
        });
    });
}

// ── Step executor (returns log + whether it hard-failed) ─────────────────────

type ExecResult = { failed: boolean; log: string };

async function executeSteps(
    steps: AgentStep[],
    userId: string,
    agentId: string,
    prefix = ''
): Promise<ExecResult> {
    // Hard cap — never run more than MAX_STEPS_PER_PLAN steps from AI output
    const safeSteps = steps.slice(0, MAX_STEPS_PER_PLAN);
    if (safeSteps.length < steps.length) {
        emitToUser(userId, 'agent:log', {
            agentId, type: 'info',
            content: `Plan capped at ${MAX_STEPS_PER_PLAN} steps (AI returned ${steps.length}).`,
        });
    }
    steps = safeSteps;
    const logLines: string[] = [];

    const log = (line: string) => { logLines.push(line); };
    const cmd = (label: string) => {
        log(`$ ${label}`);
        emitToUser(userId, 'agent:log', { agentId, type: 'command', content: label });
    };
    const info = (msg: string) => {
        log(`[info] ${msg}`);
        emitToUser(userId, 'agent:log', { agentId, type: 'info', content: msg });
    };
    const ok = (msg: string) => {
        log(`[ok] ${msg}`);
        emitToUser(userId, 'agent:log', { agentId, type: 'success', content: msg });
    };
    const err = (msg: string) => {
        log(`[error] ${msg}`);
        emitToUser(userId, 'agent:log', { agentId, type: 'error', content: msg });
    };

    for (const step of steps) {

        if (step.type === 'message') {
            log(`[ai] ${step.content}`);
            emitToUser(userId, 'agent:log', { agentId, type: 'ai', content: step.content });
            await sleep(60);
            continue;
        }

        if (step.type === 'wait') {
            const safeMs = Math.min(step.ms, MAX_WAIT_MS);
            info(`Waiting ${safeMs}ms — ${step.description}`);
            await sleep(safeMs);
            continue;
        }

        if (step.type === 'docker_pull') {
            cmd(`docker pull ${step.image}`);
            const res = await streamCommand('docker', ['pull', step.image], userId, agentId, logLines);
            if (res.exitCode !== 0) {
                err(`Failed to pull image "${step.image}"`);
                return { failed: true, log: logLines.join('\n') };
            }
            ok(`Image pulled: ${step.image}`);
            continue;
        }

        if (step.type === 'docker_stop') {
            cmd(`docker stop ${step.container}`);
            const res = await streamCommand('docker', ['stop', step.container], userId, agentId, logLines);
            if (res.exitCode !== 0 && !step.continueOnError) {
                err(`Failed to stop "${step.container}"`);
                return { failed: true, log: logLines.join('\n') };
            }
            if (res.exitCode === 0) ok(`Stopped: ${step.container}`);
            continue;
        }

        if (step.type === 'docker_remove') {
            cmd(`docker rm -f ${step.container}`);
            const res = await streamCommand('docker', ['rm', '-f', step.container], userId, agentId, logLines);
            if (res.exitCode !== 0 && !step.continueOnError) {
                err(`Failed to remove "${step.container}"`);
                return { failed: true, log: logLines.join('\n') };
            }
            if (res.exitCode === 0) ok(`Removed: ${step.container}`);
            continue;
        }

        if (step.type === 'docker_free_port') {
            cmd(`Freeing port ${step.port}`);
            stopContainersOnPort(step.port);
            ok(`Port ${step.port} is now free`);
            continue;
        }

        if (step.type === 'docker_run') {
            // ── Hard-strip blocked flags before running ──────────────────────
            let safeArgs = step.args.filter((a, i, arr) => {
                // Strip --sysctl and its value (next token)
                if (a === '--sysctl') return false;
                if (i > 0 && arr[i - 1] === '--sysctl') return false;
                // Strip --sysctl=... inline form
                if (a.startsWith('--sysctl=')) return false;
                // Strip --privileged and --cap-add SYS_ADMIN
                if (a === '--privileged') return false;
                if (a === '--cap-add' ) return false;
                if (i > 0 && arr[i - 1] === '--cap-add') return false;
                if (a === '--network' && arr[i + 1] === 'host') return false;
                if (a === 'host' && i > 0 && arr[i - 1] === '--network') return false;
                return true;
            });
            const label = `docker run ${safeArgs.join(' ')}`;
            cmd(label);
            let res = await streamCommand('docker', ['run', ...safeArgs], userId, agentId, logLines);

            // Auto-recover: name conflict
            if (res.exitCode !== 0 && res.output.includes('already in use')) {
                const ni = safeArgs.indexOf('--name');
                if (ni !== -1 && safeArgs[ni + 1]) {
                    const name = safeArgs[ni + 1];
                    info(`Container "${name}" exists — removing and retrying…`);
                    await streamCommand('docker', ['rm', '-f', name], userId, agentId, logLines);
                    res = await streamCommand('docker', ['run', ...safeArgs], userId, agentId, logLines);
                }
            }
            // Auto-recover: port conflict
            if (res.exitCode !== 0 && res.output.includes('port is already allocated')) {
                const ports = safeArgs.filter(a => /^\d+:\d+$/.test(a)).map(a => parseInt(a.split(':')[0]));
                if (ports.length > 0) {
                    info(`Port conflict — freeing: ${ports.join(', ')}`);
                    ports.forEach(p => stopContainersOnPort(p));
                    await sleep(1_200);
                    res = await streamCommand('docker', ['run', ...safeArgs], userId, agentId, logLines);
                }
            }
            if (res.exitCode !== 0) {
                err(`Container failed to start (exit ${res.exitCode}): ${res.output.slice(-300)}`);
                return { failed: true, log: logLines.join('\n') };
            }
            ok('Container started');
            continue;
        }

        if (step.type === 'docker_exec') {
            cmd(`docker exec ${step.container} ${step.command}`);
            const res = await streamCommand('docker', ['exec', step.container, 'sh', '-c', step.command], userId, agentId, logLines);
            if (res.exitCode !== 0) {
                err(`Exec failed in "${step.container}" (exit ${res.exitCode})`);
                if (!step.continueOnError) return { failed: true, log: logLines.join('\n') };
            } else {
                ok(`Exec succeeded in "${step.container}"`);
            }
            continue;
        }

        if (step.type === 'docker_logs') {
            cmd(`docker logs --tail 30 ${step.container}`);
            await sleep(1_200);
            await streamCommand('docker', ['logs', '--tail', '30', step.container], userId, agentId, logLines);
            continue;
        }

        if (step.type === 'shell') {
            cmd(step.command);
            const res = await streamCommand('sh', ['-c', step.command], userId, agentId, logLines);
            if (res.exitCode !== 0) {
                err(`Shell command failed (exit ${res.exitCode})`);
                if (!step.continueOnError) return { failed: true, log: logLines.join('\n') };
            }
            continue;
        }

        if (step.type === 'proxy_create_domain') {
            cmd(`Registering ${step.domain} → port ${step.targetPort} in reverse proxy`);
            try {
                const fs   = require('fs');
                const path = require('path');
                const db   = await getConnection();
                const serverIp = await getAgentServerIp();
                const domain   = step.domain.toLowerCase();
                const port     = step.targetPort;
                const names    = isRootDomain(domain) ? `${domain} www.${domain}` : domain;
                const httpConf = `# Managed by Docklet Agent
server {
    listen 80;
    server_name ${names};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / {
        proxy_pass http://${serverIp}:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;
                if (!fs.existsSync(NGINX_CONFIGS_DIR_AGENT)) fs.mkdirSync(NGINX_CONFIGS_DIR_AGENT, { recursive: true });
                fs.writeFileSync(path.join(NGINX_CONFIGS_DIR_AGENT, `${domain}.conf`), httpConf);
                await db.query(
                    `INSERT INTO docklet_proxy_domains (domain, target_port, verified)
                     VALUES ($1, $2, TRUE)
                     ON CONFLICT (domain) DO UPDATE SET target_port = $2, verified = TRUE, updated_at = NOW()`,
                    [domain, port]
                );
                await new Promise<void>((resolve) => {
                    const child = spawn('docker', ['exec', NGINX_CONTAINER_AGENT, 'nginx', '-s', 'reload']);
                    child.on('close', () => resolve()); child.on('error', () => resolve());
                });
                ok(`Proxy entry created: ${domain} → port ${port}`);
            } catch (e: any) {
                err(`Failed to create proxy entry: ${e.message}`);
                return { failed: true, log: logLines.join('\n') };
            }
            continue;
        }

        if (step.type === 'proxy_enable_ssl') {
            cmd(`Enabling SSL for ${step.domain} via Let's Encrypt`);
            const result = await agentEnableSsl(step.domain, userId, agentId, logLines);
            if (!result.success) {
                err(`SSL certificate failed for ${step.domain}. Ensure the domain is verified and DNS is pointing to this server.`);
                return { failed: true, log: logLines.join('\n') };
            }
            ok(`SSL enabled for ${step.domain} — ${result.url}`);
            emitToUser(userId, 'agent:log', { agentId, type: 'ai', content: `✓ SSL is active. Your site is now available at **${result.url}**` });
            continue;
        }
    }

    return { failed: false, log: logLines.join('\n') };
}

// ── Domain-connect direct intercept (bypasses AI planner entirely) ───────────

/**
 * Extracts a domain name from a freeform message.
 * Returns null if no valid domain is found.
 */
function extractDomain(msg: string): string | null {
    const m = msg.match(/\b([a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)+)\b/g);
    if (!m) return null;
    // Prefer entries that look like subdomains (have 3+ parts) over bare IPs
    const domains = m.filter(d => !/^\d+\.\d+\.\d+\.\d+$/.test(d) && d.includes('.'));
    return domains.length ? domains[0].toLowerCase() : null;
}

/** Stopwords to ignore when scanning message for container name tokens. */
const CONTAINER_HINT_STOPWORDS = new Set([
    'connect','route','map','point','attach','link','assign','add','enable','ssl','https',
    'domain','subdomain','into','inot','in','to','for','the','a','an','and','or','of',
    'container','service','docker','docklet','my','its','with','please','check','health',
    'status','running','start','stop','restart','remove','delete','deploy','create',
]);

/**
 * Extracts meaningful words from the message (excluding domain parts and stopwords)
 * that could be part of a container name.
 */
function extractContainerWords(msg: string, domainToExclude?: string): string[] {
    const domainParts = new Set((domainToExclude ?? '').toLowerCase().split('.').filter(Boolean));
    return msg.toLowerCase()
        .replace(/[^a-z0-9\s\-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 2 && !CONTAINER_HINT_STOPWORDS.has(w) && !domainParts.has(w));
}

/**
 * Parses host port from docker ps Ports field.
 */
function parseHostPort(ports: string): number | null {
    const pm = ports?.match(/(?:0\.0\.0\.0|:::):(\d+)->/);
    return pm ? parseInt(pm[1], 10) : null;
}

/**
 * Gets the host port for a running container by best-match against hint words.
 * Returns null if no container matches.
 */
function getContainerHostPort(hintWords: string[]): number | null {
    try {
        const out = execSync(
            `docker ps --format "{{.Names}}|{{.Ports}}" --filter "status=running"`,
            { stdio: 'pipe', timeout: 5_000 }
        ).toString().trim();
        let best: { port: number; score: number } | null = null;
        for (const line of out.split('\n').filter(Boolean)) {
            const [name, ports] = line.split('|');
            const nameLower = name.toLowerCase();
            const nameParts = nameLower.split(/[\-_]+/);
            // Score = number of hint words that appear as a substring of the container name
            const score = hintWords.filter(w => nameParts.some(p => p.includes(w) || w.includes(p))).length;
            if (score === 0) continue;
            const port = parseHostPort(ports);
            if (port && (!best || score > best.score)) best = { port, score };
        }
        return best?.port ?? null;
    } catch { /* ignore */ }
    return null;
}

/**
 * Checks if the domain (or its parent) is a wildcard-verified base domain.
 */
async function getVerifiedBaseDomain(subdomain: string): Promise<{ baseDomain: string; vpsIp: string } | null> {
    try {
        const db = await getConnection();
        // Check exact match first, then parent
        const parts = subdomain.split('.');
        const candidates: string[] = [];
        for (let i = 1; i < parts.length; i++) candidates.push(parts.slice(i).join('.'));
        candidates.unshift(subdomain);
        for (const cand of candidates) {
            const { rows } = await db.query(
                'SELECT domain, vps_ip FROM verified_domains WHERE domain = $1 AND verified = TRUE',
                [cand]
            );
            if (rows[0]) return { baseDomain: rows[0].domain, vpsIp: rows[0].vps_ip };
        }
    } catch { /* ignore */ }
    return null;
}

/**
 * If the message is a domain-connect request, handle it directly without the AI planner.
 * Returns true if handled, false if the caller should fall through to planWithAI.
 */
async function tryDomainConnect(
    userId: string, agentId: string, message: string
): Promise<boolean> {
    // Detect pattern: connect/route/map/point <domain> to/into <container>
    const isDomainConnect = /\b(connect|route|map|point|attach|link|assign|add domain|enable ssl|ssl)\b/i.test(message)
        && /\b(domain|subdomain|\.xyz|\.com|\.io|\.net|\.org|\.app)\b/i.test(message);
    if (!isDomainConnect) return false;

    const domain = extractDomain(message);
    if (!domain || !domain.includes('.')) return false;

    emitToUser(userId, 'agent:log', { agentId, type: 'thinking', content: `Checking domain ${domain}…` });

    // ── Check proxy table for existing entry ──────────────────────────────
    let existingEntry: any = null;
    try {
        const db = await getConnection();
        const { rows } = await db.query(
            'SELECT * FROM docklet_proxy_domains WHERE domain = $1', [domain]
        );
        existingEntry = rows[0] ?? null;
    } catch { /* ignore, will proceed to base domain check */ }

    if (existingEntry?.ssl_enabled) {
        emitToUser(userId, 'agent:log', { agentId, type: 'ai', content: `✓ SSL is already active for **${domain}**. Your site: **https://${domain}**` });
        emitToUser(userId, 'agent:done', { agentId, success: true, summary: `SSL already active for ${domain}` });
        return true;
    }

    if (existingEntry?.verified && !existingEntry.ssl_enabled) {
        // Has entry, just needs SSL
        emitToUser(userId, 'agent:log', { agentId, type: 'ai', content: `Domain ${domain} is already in the proxy. Enabling SSL…` });
        const logLines: string[] = [];
        const result = await agentEnableSsl(domain, userId, agentId, logLines);
        if (result.success) {
            emitToUser(userId, 'agent:log', { agentId, type: 'success', content: `SSL enabled for ${domain} — ${result.url}` });
            emitToUser(userId, 'agent:log', { agentId, type: 'ai', content: `✓ Done! Your site is live at **${result.url}**` });
            emitToUser(userId, 'agent:done', { agentId, success: true, summary: `SSL enabled for ${domain}` });
        } else {
            emitToUser(userId, 'agent:log', { agentId, type: 'error', content: `Certbot failed for ${domain}. Check DNS and try again.` });
            emitToUser(userId, 'agent:done', { agentId, success: false, summary: `SSL failed for ${domain}` });
        }
        return true;
    }

    // ── No proxy entry yet — check wildcard base domain ───────────────────
    const base = await getVerifiedBaseDomain(domain);
    if (!base) {
        // Not covered by any wildcard
        emitToUser(userId, 'agent:log', { agentId, type: 'ai', content: `Domain **${domain}** is not verified. Please go to **Domain**, click **Add Domain**, and verify it first.` });
        emitToUser(userId, 'agent:done', { agentId, success: false, summary: `Domain ${domain} not verified` });
        return true;
    }

    // ── Wildcard covers this subdomain — find target port ─────────────────
    // Build hint word list from message (exclude domain parts, stopwords)
    const hintWords = extractContainerWords(message, domain);
    // Also add the subdomain label itself as a hint (e.g. "client" from "client.xrpflow.xyz")
    const subLabel = domain.split('.')[0];
    if (subLabel && !hintWords.includes(subLabel)) hintWords.push(subLabel);

    const targetPort = getContainerHostPort(hintWords);

    if (!targetPort) {
        const tried = hintWords.join(', ');
        emitToUser(userId, 'agent:log', { agentId, type: 'error', content: `Could not find a running container matching [${tried}]. Make sure the container is running and try again.` });
        emitToUser(userId, 'agent:done', { agentId, success: false, summary: 'Container not found' });
        return true;
    }

    emitToUser(userId, 'agent:log', { agentId, type: 'ai', content: `Base domain **${base.baseDomain}** is wildcard-verified. Connecting **${domain}** → port **${targetPort}**…` });

    // ── Step 1: Create proxy entry ────────────────────────────────────────
    const steps: AgentStep[] = [
        { type: 'proxy_create_domain', domain, targetPort, description: `Register ${domain} → port ${targetPort}` },
        { type: 'proxy_enable_ssl',    domain,              description: `Enable SSL for ${domain}` },
    ];
    const result = await executeSteps(steps, userId, agentId);
    if (result.failed) {
        emitToUser(userId, 'agent:done', { agentId, success: false, summary: `Failed to connect ${domain}` });
    } else {
        emitToUser(userId, 'agent:log', { agentId, type: 'ai', content: `✓ Done! **${domain}** is now live at **https://${domain}**` });
        emitToUser(userId, 'agent:done', { agentId, success: true, summary: `${domain} connected with SSL` });
    }
    return true;
}

// ── ReAct loop (Plan → Execute → Verify → Fix → Verify …) ────────────────────

async function runAgentLoop(
    userId: string,
    agentId: string,
    message: string,
    apiKey: string,
    model: string
): Promise<void> {
    clearCancel(agentId);
    const loopStart = Date.now();

    function timedOut(): boolean {
        if (isCancelled(agentId)) {
            emitToUser(userId, 'agent:log', { agentId, type: 'error', content: 'Agent stopped by user.' });
            return true;
        }
        if (Date.now() - loopStart > LOOP_TIMEOUT_MS) {
            emitToUser(userId, 'agent:log', {
                agentId, type: 'error',
                content: `Agent stopped: exceeded ${LOOP_TIMEOUT_MS / 60000} minute time limit.`,
            });
            return true;
        }
        return false;
    }

    // ── Fast path: domain-connect request (no AI planning needed) ──────────
    const handled = await tryDomainConnect(userId, agentId, message);
    if (handled) return;

    // ── Phase 1: Plan ──────────────────────────────────────────────────────
    emitToUser(userId, 'agent:log', {
        agentId, type: 'thinking',
        content: 'Planning your request…',
    });

    let plan: ActionPlan;
    try {
        plan = await planWithAI(message, apiKey, model);
    } catch (e: any) {
        emitToUser(userId, 'agent:log', { agentId, type: 'error', content: `Planning failed: ${e.message}` });
        emitToUser(userId, 'agent:done', { agentId, success: false, summary: 'Planning failed' });
        return;
    }

    // Emit a debug line showing how many steps were planned
    emitToUser(userId, 'agent:log', {
        agentId, type: 'info',
        content: `Plan ready — ${plan.steps.length} step(s): ${plan.steps.map(s => s.type).join(', ')}`,
    });

    emitToUser(userId, 'agent:log', { agentId, type: 'ai', content: plan.summary });

    if (timedOut()) { emitToUser(userId, 'agent:done', { agentId, success: false, summary: plan.summary }); return; }

    // ── Phase 2: Execute initial plan ─────────────────────────────────────
    const execResult = await executeSteps(plan.steps, userId, agentId);
    let accumulatedLog = execResult.log;

    if (execResult.failed) {
        emitToUser(userId, 'agent:log', {
            agentId, type: 'info',
            content: 'Execution hit an error — AI will analyse the output and attempt a fix…',
        });
    }

    if (timedOut()) { emitToUser(userId, 'agent:done', { agentId, success: false, summary: plan.summary }); return; }

    // ── Phase 3: Verify → Fix loop (bounded: MAX_VERIFY_CYCLES iterations) ──
    for (let cycle = 1; cycle <= MAX_VERIFY_CYCLES; cycle++) {

        if (timedOut()) break;

        // Mandatory 1500ms delay between every AI API call
        await sleep(AI_CALL_DELAY_MS);

        emitToUser(userId, 'agent:log', {
            agentId, type: 'verify',
            content: cycle === 1
                ? 'Verifying results…'
                : `Re-verifying after fix (attempt ${cycle}/${MAX_VERIFY_CYCLES})…`,
        });

        let evaluation: EvalResult;
        try {
            evaluation = await evaluateWithAI(message, accumulatedLog, apiKey, model);
        } catch (e: any) {
            emitToUser(userId, 'agent:log', { agentId, type: 'error', content: `AI evaluation failed: ${e.message}` });
            break;
        }

        emitToUser(userId, 'agent:log', { agentId, type: 'ai', content: evaluation.assessment });

        if (evaluation.ok) {
            emitToUser(userId, 'agent:done', { agentId, success: true, summary: plan.summary });
            return;
        }

        // No fix steps → nothing more AI can do
        if (!evaluation.fixSteps || evaluation.fixSteps.length === 0) {
            emitToUser(userId, 'agent:log', {
                agentId, type: 'error',
                content: 'Verification failed and AI provided no fix steps. Stopping.',
            });
            break;
        }

        // Last cycle — don't apply fix, just report
        if (cycle === MAX_VERIFY_CYCLES) {
            emitToUser(userId, 'agent:log', {
                agentId, type: 'error',
                content: `All ${MAX_VERIFY_CYCLES} fix attempts exhausted.`,
            });
            break;
        }

        if (timedOut()) break;

        // Apply fix steps (capped at MAX_FIX_STEPS)
        const safeFix = evaluation.fixSteps.slice(0, MAX_FIX_STEPS);
        emitToUser(userId, 'agent:log', {
            agentId, type: 'retry',
            content: `Applying fix (attempt ${cycle}/${MAX_VERIFY_CYCLES - 1}) — ${safeFix.length} step(s)…`,
        });

        const fixResult = await executeSteps(safeFix, userId, agentId);
        accumulatedLog += `\n--- FIX ATTEMPT ${cycle} ---\n` + fixResult.log;
    }

    emitToUser(userId, 'agent:done', { agentId, success: false, summary: plan.summary });
}

// ── Install Docker on host ────────────────────────────────────────────────────

async function installDockerOnHost(userId: string, agentId: string): Promise<void> {
    emitToUser(userId, 'agent:log', { agentId, type: 'info', content: 'Starting Docker installation…' });

    const script = 'curl -fsSL https://get.docker.com | sh && systemctl enable docker && systemctl start docker';
    emitToUser(userId, 'agent:log', { agentId, type: 'command', content: 'curl -fsSL https://get.docker.com | sh' });

    let succeeded = false;

    const run = (extraArgs: string[]) => new Promise<boolean>((resolve) => {
        const child = spawn('nsenter', ['-t','1','-m','-u','-i','-n','-p','--', ...extraArgs], { stdio: ['ignore','pipe','pipe'] });
        child.stdout?.on('data', (d: Buffer) => emitToUser(userId, 'agent:log', { agentId, type: 'output', content: d.toString() }));
        child.stderr?.on('data', (d: Buffer) => emitToUser(userId, 'agent:log', { agentId, type: 'output', content: d.toString() }));
        child.on('close', (code) => resolve(code === 0));
        child.on('error', () => resolve(false));
    });

    succeeded = await run(['sh', '-c', script]);

    if (!succeeded) {
        emitToUser(userId, 'agent:log', { agentId, type: 'info', content: 'Trying apt-get fallback…' });
        succeeded = await run(['sh', '-c',
            'apt-get update -qq && apt-get install -y docker.io && systemctl enable docker && systemctl start docker',
        ]);
    }

    if (succeeded) {
        emitToUser(userId, 'agent:log', { agentId, type: 'success', content: 'Docker installed and started.' });
        emitToUser(userId, 'agent:done', { agentId, success: true, summary: 'Docker installed' });
    } else {
        emitToUser(userId, 'agent:log', {
            agentId, type: 'error',
            content: 'Automatic Docker installation failed.\nManual: https://docs.docker.com/engine/install/',
        });
        emitToUser(userId, 'agent:done', { agentId, success: false, summary: 'Docker installation failed' });
    }
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.post('/run', authenticateToken, async (req, res) => {
    const { message, agentId } = req.body || {};
    if (!message || typeof message !== 'string')
        return res.status(400).json({ message: 'A message is required.' });

    const userId = getUserId(req);
    const id     = (typeof agentId === 'string' && agentId)
        ? agentId
        : `ag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const apiKey = await getSetting('nvidia_api_key');
    if (!apiKey)
        return res.status(400).json({ configured: false, message: 'AI not configured. Set up your NVIDIA API key first.' });
    const model = (await getSetting('nvidia_model')) || NVIDIA_DEFAULT_MODEL;

    try {
        // Quick check: does this request need Docker?
        emitToUser(userId, 'agent:log', { agentId: id, type: 'thinking', content: 'Checking environment…' });

        // Pre-check Docker availability via a quick plan peek
        const dockerOk = isDockerAvailable();

        // For tasks that obviously need Docker but it's missing, skip the AI call
        const needsDocker = /install|deploy|run|container|docker|redis|mongo|postgres|mysql|nginx|rabbit/i.test(message);
        if (needsDocker && !dockerOk) {
            emitToUser(userId, 'agent:log', {
                agentId: id, type: 'docker_missing',
                content: 'Docker is not installed. Would you like me to install it automatically?',
            });
            emitToUser(userId, 'agent:done', { agentId: id, success: false, summary: 'Docker required', dockerMissing: true });
            return res.json({ agentId: id, dockerMissing: true });
        }

        res.json({ agentId: id, started: true });

        setImmediate(() => {
            runAgentLoop(userId, id, message, apiKey, model).catch(err => {
                emitToUser(userId, 'agent:log', { agentId: id, type: 'error', content: `Agent crashed: ${err.message}` });
                emitToUser(userId, 'agent:done', { agentId: id, success: false, summary: 'Agent crashed' });
            });
        });
    } catch (err: any) {
        const status = err?.status >= 100 && err?.status < 600 ? err.status : 500;
        const msg    = (status === 401 || status === 403)
            ? 'AI API key is invalid or expired. Please update it in AI settings.'
            : (err?.message || 'Agent failed');
        return res.status(status === 401 || status === 403 ? 400 : status).json({ message: msg });
    }
});

router.post('/cancel', authenticateToken, async (req, res) => {
    const { agentId } = req.body || {};
    if (!agentId || typeof agentId !== 'string')
        return res.status(400).json({ message: 'agentId required' });
    cancelAgent(agentId);
    res.json({ cancelled: true, agentId });
});

router.post('/install-docker', authenticateToken, async (req, res) => {
    const { agentId } = req.body || {};
    const userId = getUserId(req);
    const id     = (typeof agentId === 'string' && agentId) ? agentId : `ag_docker_${Date.now()}`;
    res.json({ agentId: id, started: true });
    setImmediate(() => {
        installDockerOnHost(userId, id).catch(err => {
            emitToUser(userId, 'agent:log', { agentId: id, type: 'error', content: `Crashed: ${err.message}` });
            emitToUser(userId, 'agent:done', { agentId: id, success: false, summary: 'Docker install failed' });
        });
    });
});

export default router;
