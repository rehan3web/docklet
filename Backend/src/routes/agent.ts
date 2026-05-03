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
const MAX_VERIFY_CYCLES    = 2;      // max Plan→Execute→Verify loops
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
7. Use "wait" to pause after starting slow-init services (MySQL/MariaDB: 20000ms, MongoDB: 8000ms, PostgreSQL: 5000ms, RabbitMQ: 12000ms, others: 3000ms).
8. Container names: lowercase alphanumeric + hyphens only.
9. Always use --restart=unless-stopped and -d for persistent services.
10. CRITICAL — docker_run args array: EVERY flag and its value MUST be a SEPARATE element. NEVER combine them.
    CORRECT:   ["args": ["-d", "-e", "MYSQL_ROOT_PASSWORD=root", "-p", "3306:3306", "mysql:8"]]
    WRONG:     ["args": ["-d", "-e MYSQL_ROOT_PASSWORD=root", "-p 3306:3306", "mysql:8"]]
11. For services that need passwords (MySQL, MariaDB, PostgreSQL, MinIO): if the user did not specify a password, use "rootpass" as the default. NEVER leave a password field empty or as a placeholder like <password>.
12. After docker_run, always add a "wait" step (minimum 3000ms) then a docker_exec health-check step to verify the service started correctly.

ENVIRONMENT CONSTRAINTS (this host is a shared/containerized Linux environment):
- NEVER use --sysctl flags in docker run — they are blocked (e.g. vm.overcommit_memory, net.core.*). Drop them silently.
- NEVER use --privileged or --cap-add SYS_ADMIN — not allowed.
- NEVER use --network host — use explicit -p port mappings instead.
- Redis: run WITHOUT --sysctl; add --loglevel warning to suppress the overcommit warning. Redis works fine without it.
- Elasticsearch/OpenSearch: set -e "discovery.type=single-node" and -e "xpack.security.enabled=false" instead of kernel tweaks.
- If a previous attempt failed with "not allowed", "operation not permitted", or "invalid argument" for a flag, OMIT that flag entirely — do not retry it.

DOCKER IMAGE SELECTION (fully dynamic — no hardcoded list):
- The user context will include a DOCKER HUB SEARCH RESULTS section with live results fetched from Docker Hub for the requested service.
- Use the [OFFICIAL] image when available — it is the safest, best-maintained choice.
- Pick the most relevant image from the search results based on star count and description.
- Choose a stable tag (e.g. ":alpine", ":8", ":16-alpine") over ":latest" when it is obvious from the image name.
- Use the EXACT image name from the search results — do not guess or invent image names.
- If no search results are provided, use the well-known official Docker Hub name for the service.

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

STEP SCHEMA — every step MUST have a "type" key. Use EXACTLY these formats:

{ "type": "message",          "content": "some text" }
{ "type": "wait",             "ms": 8000, "description": "Wait for service to initialise" }
{ "type": "docker_pull",      "image": "mongo:7", "description": "Pull image" }
{ "type": "docker_run",       "args": ["-d","--name","mongodb","--restart=unless-stopped","-p","27017:27017","-e","MONGO_INITDB_ROOT_USERNAME=admin","-e","MONGO_INITDB_ROOT_PASSWORD=rootpass","mongo:7"], "description": "Start MongoDB" }
{ "type": "docker_exec",      "container": "mongodb", "command": "mongosh --eval \"db.adminCommand({ping:1})\" --quiet", "description": "Ping", "continueOnError": true }
{ "type": "docker_stop",      "container": "name", "description": "...", "continueOnError": true }
{ "type": "docker_remove",    "container": "name", "description": "...", "continueOnError": true }
{ "type": "docker_free_port", "port": 27017, "description": "Free port" }
{ "type": "docker_logs",      "container": "name", "description": "Show logs" }
{ "type": "shell",            "command": "single-command-no-operators", "description": "...", "continueOnError": false }
{ "type": "proxy_create_domain", "domain": "sub.example.com", "targetPort": 3000, "description": "..." }
{ "type": "proxy_enable_ssl",    "domain": "sub.example.com", "description": "..." }

CRITICAL: The "type" field MUST be present on every step object. Do NOT use "action", "step", or any other key name.
CRITICAL: All health-check docker_exec steps MUST have "continueOnError": true so a slow-starting service does not abort the plan.

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

fixSteps MUST use the exact same step schema as the planner — every step MUST have a "type" field:
{ "type": "docker_run",    "args": ["-d","--name","mysql","--restart=unless-stopped","-p","3306:3306","-e","MYSQL_ROOT_PASSWORD=rootpass","mysql:8"], "description": "..." }
{ "type": "docker_exec",   "container": "mysql", "command": "mysqladmin ping -u root --password=rootpass --silent", "description": "...", "continueOnError": true }
{ "type": "docker_stop",   "container": "name", "description": "...", "continueOnError": true }
{ "type": "docker_remove", "container": "name", "description": "...", "continueOnError": true }
{ "type": "docker_free_port", "port": 3306, "description": "..." }
{ "type": "wait",          "ms": 5000, "description": "..." }
CRITICAL: Use "type" — NOT "action", "step", "name", or any other key.

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
  "fixSteps": [ { "type": "...", ... }, ... ]
}`;

// ── AI calls ──────────────────────────────────────────────────────────────────

function makeOpenAI(apiKey: string): OpenAI {
    return new OpenAI({ apiKey, baseURL: NVIDIA_BASE_URL });
}

// ── Step normaliser (shared by planner + evaluator) ──────────────────────────

const KNOWN_STEP_TYPES = new Set([
    'message','wait','docker_pull','docker_run','docker_exec','docker_stop',
    'docker_remove','docker_free_port','docker_logs','shell',
    'proxy_create_domain','proxy_enable_ssl',
]);

function normaliseSteps(steps: any[]): any[] {
    if (!Array.isArray(steps)) return [];
    return steps.map((s: any) => {
        if (!s || typeof s !== 'object') return s;

        // Already has a valid type — done
        if (s.type && KNOWN_STEP_TYPES.has(s.type)) return s;

        // String-alias fields: "action", "name", "operation", "kind", etc.
        const typeAliases = ['action','step_type','step','name','operation','command_type','kind','tool','id'];
        for (const alias of typeAliases) {
            if (s[alias] && typeof s[alias] === 'string' && KNOWN_STEP_TYPES.has(s[alias])) {
                const { [alias]: _rm, ...rest } = s;
                return { type: s[alias], ...rest };
            }
        }

        // Any string VALUE in the object that matches a known type
        // e.g. { "id": "docker_run", "args": [...] }
        for (const val of Object.values(s)) {
            if (typeof val === 'string' && KNOWN_STEP_TYPES.has(val)) {
                return { ...s, type: val };
            }
        }

        // Key-as-type: { "docker_run": { "args": [...] } }  or  { "docker_pull": "mongo:7" }
        const fieldMap: Record<string,string> = {
            docker_pull: 'image', docker_stop: 'container', docker_remove: 'container',
            docker_logs: 'container', docker_exec: 'container', shell: 'command',
        };
        for (const key of Object.keys(s)) {
            if (!KNOWN_STEP_TYPES.has(key)) continue;
            const val = s[key];
            if (val && typeof val === 'object') {
                return { type: key, ...val };
            } else {
                const field = fieldMap[key] || 'value';
                const { [key]: _v, ...rest } = s;
                return { type: key, [field]: val, ...rest };
            }
        }

        return s;
    });
}

// ── Docker Hub live search ────────────────────────────────────────────────────

/**
 * Extracts the primary service name(s) from an install request.
 * Returns an empty array if this doesn't look like an install request.
 */
function extractServiceNames(message: string): string[] {
    const installIntent = /\b(install|deploy|start|run|setup|set up|add|launch|create|spin up|bring up)\b/i;
    if (!installIntent.test(message)) return [];

    const stopwords = new Set([
        'a', 'an', 'the', 'on', 'in', 'at', 'with', 'for', 'and', 'or', 'of',
        'server', 'service', 'instance', 'container', 'docker', 'it', 'this', 'my',
        'port', 'using', 'latest', 'version', 'default', 'password', 'root', 'me',
        'please', 'install', 'deploy', 'start', 'run', 'setup', 'add', 'launch',
        'create', 'spin', 'up', 'bring', 'set', 'new', 'latest', 'stable',
    ]);

    const words = message.toLowerCase()
        .replace(/[^a-z0-9\s\-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 2 && !stopwords.has(w));

    // Return up to 2 unique candidates
    return [...new Set(words)].slice(0, 2);
}

/**
 * Searches Docker Hub for the given query and returns a formatted string
 * with the top results (name, official badge, star count, description).
 */
async function searchDockerHub(query: string): Promise<string> {
    try {
        const url = `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(query)}&page_size=6`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
        if (!res.ok) return 'Docker Hub search unavailable.';
        const data = await res.json() as any;
        const items: any[] = data.results || [];
        if (!items.length) return `No images found on Docker Hub for "${query}".`;
        return items.map((r: any) => {
            const name     = r.repo_name || r.name || '?';
            const stars    = r.star_count ?? 0;
            const official = r.is_official ? ' [OFFICIAL]' : '';
            const desc     = (r.short_description || '').replace(/\s+/g, ' ').trim().slice(0, 100);
            return `  ${name}${official} ★${stars}${desc ? ' — ' + desc : ''}`;
        }).join('\n');
    } catch {
        return 'Docker Hub search unavailable.';
    }
}

async function planWithAI(message: string, apiKey: string, model: string): Promise<ActionPlan> {
    const context   = isDockerAvailable() ? getDockerContext() : 'Docker is not available.';
    const domainCtx = await getDomainContext();

    // Live Docker Hub search for install requests
    let hubSection = '';
    const serviceNames = extractServiceNames(message);
    if (serviceNames.length > 0) {
        const results = await Promise.all(serviceNames.map(s => searchDockerHub(s)));
        const parts = serviceNames.map((s, i) => `Search: "${s}"\n${results[i]}`).join('\n\n');
        hubSection = `\n\nDOCKER HUB SEARCH RESULTS (use these image names — do not guess):\n${parts}`;
    }

    const userPrompt = `LIVE DOCKER CONTEXT:\n${context}\n\nDOMAIN CONTEXT:\n${domainCtx}${hubSection}\n\nUSER REQUEST: ${message}`;

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
    try {
        const parsed = JSON.parse(cleaned);

        // ── Normalise "steps" array — handle any key name the AI might use ──────
        if (!Array.isArray(parsed.steps)) {
            for (const key of ['plan','actions','tasks','commands','items']) {
                if (Array.isArray(parsed[key])) { parsed.steps = parsed[key]; break; }
            }
        }
        if (!Array.isArray(parsed.steps)) parsed.steps = [];

        parsed.steps = normaliseSteps(parsed.steps);

        // Log for debugging
        console.log('[agent] plan step types:', parsed.steps.map((s: any) => s?.type));
        return parsed;
    } catch {
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
        const rawFix = Array.isArray(parsed.fixSteps) ? parsed.fixSteps : [];
        return {
            ok:         Boolean(parsed.ok),
            assessment: String(parsed.assessment || ''),
            fixSteps:   normaliseSteps(rawFix),
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
            // ── Split any space-joined args the AI may have combined ──────────
            // e.g. "-e MYSQL_ROOT_PASSWORD=root" must be ["-e", "MYSQL_ROOT_PASSWORD=root"]
            let expandedArgs: string[] = [];
            for (const a of step.args) {
                if (typeof a === 'string' && a.includes(' ') && (a.startsWith('-') || /^[A-Z_]+=/.test(a))) {
                    expandedArgs.push(...a.split(/\s+/).filter(Boolean));
                } else {
                    expandedArgs.push(a);
                }
            }

            // ── Hard-strip blocked flags ──────────────────────────────────────
            let safeArgs = expandedArgs.filter((a, i, arr) => {
                if (a === '--sysctl') return false;
                if (i > 0 && arr[i - 1] === '--sysctl') return false;
                if (a.startsWith('--sysctl=')) return false;
                if (a === '--privileged') return false;
                if (a === '--cap-add') return false;
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
                err(`Container failed to start (exit ${res.exitCode}): ${res.output.slice(-400)}`);
                return { failed: true, log: logLines.join('\n') };
            }

            // ── Detect silent crash: container started but exited immediately ─
            // docker run -d returns 0 even if the container dies right away.
            // Wait 2s then check if it is actually still running.
            await sleep(2_000);
            const nameIdx = safeArgs.indexOf('--name');
            const containerName = nameIdx !== -1 ? safeArgs[nameIdx + 1] : null;
            if (containerName) {
                try {
                    const statusOut = execSync(
                        `docker inspect --format "{{.State.Status}}" ${containerName}`,
                        { stdio: 'pipe', timeout: 5_000 }
                    ).toString().trim();
                    if (statusOut === 'exited' || statusOut === 'dead') {
                        err(`Container "${containerName}" exited immediately after start (status: ${statusOut}). Fetching logs…`);
                        await streamCommand('docker', ['logs', '--tail', '50', containerName], userId, agentId, logLines);
                        return { failed: true, log: logLines.join('\n') };
                    }
                } catch { /* container may not exist yet — ignore */ }
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

// ── Hardcoded service recipes (reliable, no AI planning needed) ───────────────

interface ServiceRecipe {
    name: string;
    summary: string;
    steps: AgentStep[];
}

function getServiceRecipePlan(message: string): ServiceRecipe | null {
    const m = message.toLowerCase();

    // Only activate for install/deploy/start/setup/run requests
    const isInstall = /\b(install|deploy|start|setup|run|launch|create|spin up|add)\b/.test(m);
    if (!isInstall) return null;

    if (/\bmongo(db)?\b/.test(m)) return {
        name: 'MongoDB',
        summary: 'Deploy MongoDB 7 on port 27017',
        steps: [
            { type: 'docker_free_port', port: 27017, description: 'Free port 27017' },
            { type: 'docker_run', args: [
                '-d', '--name', 'mongodb', '--restart=unless-stopped',
                '-p', '27017:27017',
                '-e', 'MONGO_INITDB_ROOT_USERNAME=admin',
                '-e', 'MONGO_INITDB_ROOT_PASSWORD=rootpass',
                'mongo:7',
            ], description: 'Start MongoDB 7' },
            { type: 'wait', ms: 8000, description: 'Wait for MongoDB to initialise' },
            { type: 'docker_exec', container: 'mongodb', continueOnError: true,
                command: 'mongosh --eval "db.adminCommand({ping:1})" -u admin -p rootpass --authenticationDatabase admin --quiet',
                description: 'Ping MongoDB' },
        ],
    };

    if (/\bmysql\b/.test(m)) return {
        name: 'MySQL',
        summary: 'Deploy MySQL 8 on port 3306',
        steps: [
            { type: 'docker_free_port', port: 3306, description: 'Free port 3306' },
            { type: 'docker_run', args: [
                '-d', '--name', 'mysql', '--restart=unless-stopped',
                '-p', '3306:3306',
                '-e', 'MYSQL_ROOT_PASSWORD=rootpass',
                'mysql:8',
            ], description: 'Start MySQL 8' },
            { type: 'wait', ms: 25000, description: 'Wait for MySQL to initialise (~25s)' },
            { type: 'docker_exec', container: 'mysql', continueOnError: true,
                command: 'mysqladmin ping -u root --password=rootpass --silent',
                description: 'Ping MySQL' },
        ],
    };

    if (/\bmariadb\b/.test(m)) return {
        name: 'MariaDB',
        summary: 'Deploy MariaDB on port 3306',
        steps: [
            { type: 'docker_free_port', port: 3306, description: 'Free port 3306' },
            { type: 'docker_run', args: [
                '-d', '--name', 'mariadb', '--restart=unless-stopped',
                '-p', '3306:3306',
                '-e', 'MARIADB_ROOT_PASSWORD=rootpass',
                'mariadb:latest',
            ], description: 'Start MariaDB' },
            { type: 'wait', ms: 15000, description: 'Wait for MariaDB to initialise' },
            { type: 'docker_exec', container: 'mariadb', continueOnError: true,
                command: 'mysqladmin ping -u root --password=rootpass --silent',
                description: 'Ping MariaDB' },
        ],
    };

    if (/\bredis\b/.test(m)) return {
        name: 'Redis',
        summary: 'Deploy Redis 7 on port 6379',
        steps: [
            { type: 'docker_free_port', port: 6379, description: 'Free port 6379' },
            { type: 'docker_run', args: [
                '-d', '--name', 'redis', '--restart=unless-stopped',
                '-p', '6379:6379',
                'redis:7-alpine', '--requirepass', 'rootpass',
            ], description: 'Start Redis 7' },
            { type: 'wait', ms: 2000, description: 'Wait for Redis' },
            { type: 'docker_exec', container: 'redis', continueOnError: true,
                command: 'redis-cli -a rootpass ping',
                description: 'Ping Redis' },
        ],
    };

    if (/\bpostgres(ql)?\b/.test(m)) return {
        name: 'PostgreSQL',
        summary: 'Deploy PostgreSQL 16 on port 5432',
        steps: [
            { type: 'docker_free_port', port: 5432, description: 'Free port 5432' },
            { type: 'docker_run', args: [
                '-d', '--name', 'postgres', '--restart=unless-stopped',
                '-p', '5432:5432',
                '-e', 'POSTGRES_PASSWORD=rootpass',
                '-e', 'POSTGRES_USER=admin',
                '-e', 'POSTGRES_DB=app',
                'postgres:16-alpine',
            ], description: 'Start PostgreSQL 16' },
            { type: 'wait', ms: 5000, description: 'Wait for PostgreSQL' },
            { type: 'docker_exec', container: 'postgres', continueOnError: true,
                command: 'pg_isready -U admin',
                description: 'Check PostgreSQL ready' },
        ],
    };

    if (/\b(rabbit(mq)?)\b/.test(m)) return {
        name: 'RabbitMQ',
        summary: 'Deploy RabbitMQ 3 on ports 5672 / 15672',
        steps: [
            { type: 'docker_free_port', port: 5672,  description: 'Free port 5672' },
            { type: 'docker_free_port', port: 15672, description: 'Free port 15672' },
            { type: 'docker_run', args: [
                '-d', '--name', 'rabbitmq', '--restart=unless-stopped',
                '-p', '5672:5672',
                '-p', '15672:15672',
                '-e', 'RABBITMQ_DEFAULT_USER=admin',
                '-e', 'RABBITMQ_DEFAULT_PASS=rootpass',
                'rabbitmq:3-management',
            ], description: 'Start RabbitMQ 3 with management UI' },
            { type: 'wait', ms: 12000, description: 'Wait for RabbitMQ to initialise' },
            { type: 'docker_exec', container: 'rabbitmq', continueOnError: true,
                command: 'rabbitmq-diagnostics ping --quiet',
                description: 'Ping RabbitMQ' },
        ],
    };

    if (/\bnginx\b/.test(m) && !/proxy/.test(m)) return {
        name: 'Nginx',
        summary: 'Deploy Nginx on port 80',
        steps: [
            { type: 'docker_free_port', port: 80, description: 'Free port 80' },
            { type: 'docker_run', args: [
                '-d', '--name', 'nginx', '--restart=unless-stopped',
                '-p', '80:80',
                'nginx:alpine',
            ], description: 'Start Nginx' },
            { type: 'wait', ms: 2000, description: 'Wait for Nginx' },
            { type: 'docker_exec', container: 'nginx', continueOnError: true,
                command: 'nginx -t',
                description: 'Test Nginx config' },
        ],
    };

    if (/\bgrafana\b/.test(m)) return {
        name: 'Grafana',
        summary: 'Deploy Grafana on port 3000',
        steps: [
            { type: 'docker_free_port', port: 3000, description: 'Free port 3000' },
            { type: 'docker_run', args: [
                '-d', '--name', 'grafana', '--restart=unless-stopped',
                '-p', '3000:3000',
                '-e', 'GF_SECURITY_ADMIN_PASSWORD=rootpass',
                'grafana/grafana:latest',
            ], description: 'Start Grafana' },
            { type: 'wait', ms: 5000, description: 'Wait for Grafana' },
            { type: 'docker_exec', container: 'grafana', continueOnError: true,
                command: 'wget -qO- http://localhost:3000/api/health',
                description: 'Check Grafana health' },
        ],
    };

    if (/\bprometheus\b/.test(m)) return {
        name: 'Prometheus',
        summary: 'Deploy Prometheus on port 9090',
        steps: [
            { type: 'docker_free_port', port: 9090, description: 'Free port 9090' },
            { type: 'docker_run', args: [
                '-d', '--name', 'prometheus', '--restart=unless-stopped',
                '-p', '9090:9090',
                'prom/prometheus:latest',
            ], description: 'Start Prometheus' },
            { type: 'wait', ms: 4000, description: 'Wait for Prometheus' },
            { type: 'docker_exec', container: 'prometheus', continueOnError: true,
                command: 'wget -qO- http://localhost:9090/-/ready',
                description: 'Check Prometheus ready' },
        ],
    };

    if (/\bminio\b/.test(m)) return {
        name: 'MinIO',
        summary: 'Deploy MinIO on ports 9000 / 9001',
        steps: [
            { type: 'docker_free_port', port: 9000, description: 'Free port 9000' },
            { type: 'docker_free_port', port: 9001, description: 'Free port 9001' },
            { type: 'docker_run', args: [
                '-d', '--name', 'minio', '--restart=unless-stopped',
                '-p', '9000:9000',
                '-p', '9001:9001',
                '-e', 'MINIO_ROOT_USER=admin',
                '-e', 'MINIO_ROOT_PASSWORD=rootpass123',
                'minio/minio:latest',
                'server', '/data', '--console-address', ':9001',
            ], description: 'Start MinIO' },
            { type: 'wait', ms: 5000, description: 'Wait for MinIO' },
            { type: 'docker_exec', container: 'minio', continueOnError: true,
                command: 'mc ready local 2>/dev/null || echo "MinIO up"',
                description: 'Check MinIO status' },
        ],
    };

    if (/\bmemcached\b/.test(m)) return {
        name: 'Memcached',
        summary: 'Deploy Memcached on port 11211',
        steps: [
            { type: 'docker_free_port', port: 11211, description: 'Free port 11211' },
            { type: 'docker_run', args: [
                '-d', '--name', 'memcached', '--restart=unless-stopped',
                '-p', '11211:11211',
                'memcached:alpine',
            ], description: 'Start Memcached' },
            { type: 'wait', ms: 2000, description: 'Wait for Memcached' },
        ],
    };

    if (/\bn8n\b/.test(m)) return {
        name: 'n8n',
        summary: 'Deploy n8n workflow automation on port 5678',
        steps: [
            { type: 'docker_free_port', port: 5678, description: 'Free port 5678' },
            { type: 'docker_run', args: [
                '-d', '--name', 'n8n', '--restart=unless-stopped',
                '-p', '5678:5678',
                '-e', 'N8N_BASIC_AUTH_ACTIVE=true',
                '-e', 'N8N_BASIC_AUTH_USER=admin',
                '-e', 'N8N_BASIC_AUTH_PASSWORD=rootpass',
                'n8nio/n8n:latest',
            ], description: 'Start n8n' },
            { type: 'wait', ms: 8000, description: 'Wait for n8n' },
        ],
    };

    if (/\belastic(search)?\b/.test(m)) return {
        name: 'Elasticsearch',
        summary: 'Deploy Elasticsearch 8 on port 9200',
        steps: [
            { type: 'docker_free_port', port: 9200, description: 'Free port 9200' },
            { type: 'docker_run', args: [
                '-d', '--name', 'elasticsearch', '--restart=unless-stopped',
                '-p', '9200:9200',
                '-e', 'discovery.type=single-node',
                '-e', 'xpack.security.enabled=false',
                '-e', 'ES_JAVA_OPTS=-Xms512m -Xmx512m',
                'elasticsearch:8.13.0',
            ], description: 'Start Elasticsearch 8' },
            { type: 'wait', ms: 20000, description: 'Wait for Elasticsearch to initialise' },
            { type: 'docker_exec', container: 'elasticsearch', continueOnError: true,
                command: 'curl -s http://localhost:9200/_cluster/health | grep -q status',
                description: 'Check Elasticsearch health' },
        ],
    };

    return null;
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

    // ── Phase 1: Plan (AI — searches Docker Hub dynamically) ──────────────
    emitToUser(userId, 'agent:log', {
        agentId, type: 'thinking',
        content: 'Searching Docker Hub and planning your request…',
    });

    let plan: ActionPlan;
    try {
        plan = await planWithAI(message, apiKey, model);
    } catch (e: any) {
        emitToUser(userId, 'agent:log', { agentId, type: 'error', content: `Planning failed: ${e.message}` });
        emitToUser(userId, 'agent:done', { agentId, success: false, summary: 'Planning failed' });
        return;
    }

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
