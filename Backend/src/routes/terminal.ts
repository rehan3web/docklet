import express from 'express';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import OpenAI from 'openai';
import { authenticateToken } from '../middleware/auth';
import { checkSafety, COMMAND_SUGGESTIONS } from '../lib/safety';
import { getSetting, setSetting, deleteSetting } from '../lib/settings';
import { emitToUser } from '../lib/socket';

const router = express.Router();

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_DEFAULT_MODEL = 'openai/gpt-oss-120b';
const COMMAND_TIMEOUT_MS = 30_000;

// Per-user in-memory terminal history (last N entries per user). History is
// scoped to the requesting user so command/output of one user is never
// disclosed to another.
type HistoryEntry = {
    id: string;
    command: string;
    output: string;
    exitCode: number | null;
    timestamp: number;
    durationMs: number;
};
const HISTORY_LIMIT = 100;
const userHistory = new Map<string, HistoryEntry[]>();

// Per-user persistent working directory for each terminal mode.
const rootCwd  = new Map<string, string>();
const sandboxCwd = new Map<string, string>();

const CWD_MARKER_START = '~~DOCKLET_CWD_START~~';
const CWD_MARKER_END   = '~~DOCKLET_CWD_END~~';

function getUserId(req: any): string {
    const u = req.user;
    return String(u?.id ?? u?.username ?? 'anonymous');
}

function pushHistory(userId: string, entry: HistoryEntry) {
    let arr = userHistory.get(userId);
    if (!arr) { arr = []; userHistory.set(userId, arr); }
    arr.push(entry);
    if (arr.length > HISTORY_LIMIT) arr.shift();
}

router.get('/suggestions', authenticateToken, (_req, res) => {
    res.json({ suggestions: COMMAND_SUGGESTIONS });
});

router.get('/history', authenticateToken, (req, res) => {
    res.json({ history: userHistory.get(getUserId(req)) || [] });
});

router.delete('/history', authenticateToken, (req, res) => {
    userHistory.delete(getUserId(req));
    res.json({ ok: true });
});

router.post('/safety-check', authenticateToken, (req, res) => {
    const { command } = req.body || {};
    const result = checkSafety(command || '');
    res.json(result);
});

// Return the current working directory for each terminal mode.
router.get('/cwd', authenticateToken, (req, res) => {
    const userId = getUserId(req);
    res.json({
        rootCwd:    rootCwd.get(userId)    || '/root',
        sandboxCwd: sandboxCwd.get(userId) || '/usr/src/app',
    });
});

router.post('/exec', authenticateToken, async (req, res) => {
    const { command, confirm, clientId, rootMode } = req.body || {};
    const cmd = (command || '').toString().trim();
    if (!cmd) return res.status(400).json({ message: 'Command is required' });

    const safety = checkSafety(cmd);
    if (!safety.safe && confirm !== 'I CONFIRM') {
        return res.status(200).json({
            requiresConfirmation: true,
            reason: safety.reason,
            message: `Dangerous command detected: ${safety.reason}. Confirmation required.`,
        });
    }

    const safeClientId = (typeof clientId === 'string' && /^c_[a-zA-Z0-9]{6,32}$/.test(clientId))
        ? clientId
        : null;
    const id = safeClientId || `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    const userId = getUserId(req);

    // Wrap the user command with cwd persistence:
    //   cd <stored_cwd>; <user_cmd>; echo "~~DOCKLET_CWD_START~~$(pwd)~~DOCKLET_CWD_END~~"
    // After output is collected we parse+strip the marker and store the new cwd.
    let child: ReturnType<typeof spawn>;
    let execCmd: string;
    if (rootMode) {
        const cwd = rootCwd.get(userId) || '/root';
        execCmd = cmd;
        const wrapped = `cd ${JSON.stringify(cwd)} 2>/dev/null || true; ${cmd}; echo "${CWD_MARKER_START}$(pwd)${CWD_MARKER_END}"`;
        emitToUser(userId, 'terminal-start', { id, command: execCmd, timestamp: startedAt });
        child = spawn('nsenter', ['-t', '1', '-m', '-u', '-i', '-n', '-p', '--', 'bash', '-c', wrapped], {
            env: process.env,
        });
    } else {
        const cwd = sandboxCwd.get(userId) || '/usr/src/app';
        execCmd = cmd;
        const wrapped = `cd ${JSON.stringify(cwd)} 2>/dev/null || true; ${cmd}; echo "${CWD_MARKER_START}$(pwd)${CWD_MARKER_END}"`;
        emitToUser(userId, 'terminal-start', { id, command: execCmd, timestamp: startedAt });
        const shell = existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
        child = spawn(shell, ['-c', wrapped], { env: process.env });
    }

    let output = '';
    let finished = false;
    let detectedCwd = '';

    // Stdout is buffered so we can intercept and strip the cwd marker line
    // before it reaches the client's terminal display.
    let stdoutBuf = '';
    const HOLD = CWD_MARKER_START.length - 1;

    function flushStdout(force = false) {
        const markerIdx = stdoutBuf.indexOf(CWD_MARKER_START);
        if (markerIdx !== -1) {
            // Emit everything before the marker
            const before = stdoutBuf.slice(0, markerIdx);
            if (before) {
                output += before;
                emitToUser(userId, 'terminal-output', { id, chunk: before, stream: 'stdout' });
            }
            // Extract the new cwd
            const endIdx = stdoutBuf.indexOf(CWD_MARKER_END, markerIdx);
            if (endIdx !== -1) {
                detectedCwd = stdoutBuf.slice(markerIdx + CWD_MARKER_START.length, endIdx).trim();
            }
            stdoutBuf = ''; // discard everything from marker onward
        } else if (force) {
            if (stdoutBuf) {
                output += stdoutBuf;
                emitToUser(userId, 'terminal-output', { id, chunk: stdoutBuf, stream: 'stdout' });
                stdoutBuf = '';
            }
        } else {
            // Hold back enough bytes that a split marker can still be detected
            if (stdoutBuf.length > HOLD) {
                const toEmit = stdoutBuf.slice(0, stdoutBuf.length - HOLD);
                output += toEmit;
                emitToUser(userId, 'terminal-output', { id, chunk: toEmit, stream: 'stdout' });
                stdoutBuf = stdoutBuf.slice(stdoutBuf.length - HOLD);
            }
        }
    }

    const timeout = setTimeout(() => {
        if (!finished) {
            try { child.kill('SIGKILL'); } catch { /* ignore */ }
            emitToUser(userId, 'terminal-output', { id, chunk: `\n[command timed out after ${COMMAND_TIMEOUT_MS / 1000}s]\n`, stream: 'stderr' });
        }
    }, COMMAND_TIMEOUT_MS);

    child.stdout?.on('data', (data) => {
        stdoutBuf += data.toString();
        flushStdout();
    });
    child.stderr?.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        emitToUser(userId, 'terminal-output', { id, chunk, stream: 'stderr' });
    });

    child.on('error', (err) => {
        finished = true;
        clearTimeout(timeout);
        flushStdout(true);
        const errMsg = `\n[failed to spawn: ${err.message}]\n`;
        output += errMsg;
        emitToUser(userId, 'terminal-output', { id, chunk: errMsg, stream: 'stderr' });
        const entry: HistoryEntry = { id, command: cmd, output, exitCode: -1, timestamp: startedAt, durationMs: Date.now() - startedAt };
        pushHistory(userId, entry);
        emitToUser(userId, 'terminal-end', { id, exitCode: -1, durationMs: entry.durationMs });
        if (!res.headersSent) {
            res.status(500).json({ id, output, exitCode: -1, error: err.message });
        }
    });

    child.on('close', (exitCode) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        flushStdout(true);
        // Persist the detected cwd; fall back to the previous value on failure
        if (detectedCwd) {
            if (rootMode) rootCwd.set(userId, detectedCwd);
            else sandboxCwd.set(userId, detectedCwd);
        }
        const newCwd = detectedCwd || (rootMode ? rootCwd.get(userId) || '/root' : sandboxCwd.get(userId) || '/usr/src/app');
        const durationMs = Date.now() - startedAt;
        const entry: HistoryEntry = { id, command: cmd, output, exitCode, timestamp: startedAt, durationMs };
        pushHistory(userId, entry);
        emitToUser(userId, 'terminal-end', { id, exitCode, durationMs, cwd: newCwd });
        if (!res.headersSent) {
            res.json({ id, output, exitCode, durationMs, cwd: newCwd });
        }
    });
});

// ── AI / NVIDIA LLM Integration ───────────────────────────────────────────────

router.get('/settings', authenticateToken, async (_req, res) => {
    const apiKey = await getSetting('nvidia_api_key');
    const model = await getSetting('nvidia_model');
    res.json({
        configured: !!apiKey,
        model: model || NVIDIA_DEFAULT_MODEL,
        // Mask the key for display
        apiKeyMasked: apiKey ? `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}` : null,
    });
});

router.post('/settings', authenticateToken, async (req, res) => {
    const { apiKey, model } = req.body || {};
    if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 8) {
        return res.status(400).json({ message: 'A valid NVIDIA API key is required.' });
    }
    await setSetting('nvidia_api_key', apiKey.trim());
    if (model && typeof model === 'string') {
        await setSetting('nvidia_model', model.trim());
    }
    res.json({ ok: true });
});

router.delete('/settings', authenticateToken, async (_req, res) => {
    await deleteSetting('nvidia_api_key');
    await deleteSetting('nvidia_model');
    res.json({ ok: true });
});

router.post('/ai', authenticateToken, async (req, res) => {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ message: 'A prompt is required.' });
    }

    const apiKey = await getSetting('nvidia_api_key');
    if (!apiKey) {
        return res.status(400).json({
            configured: false,
            message: 'NVIDIA API key is not configured. Open Terminal Settings to add one.',
        });
    }
    const model = (await getSetting('nvidia_model')) || NVIDIA_DEFAULT_MODEL;

    try {
        const openai = new OpenAI({ apiKey, baseURL: NVIDIA_BASE_URL });
        const completion = await openai.chat.completions.create({
            model,
            messages: [
                {
                    role: 'system',
                    content:
                        'You are a Linux shell expert. The user describes a task in natural language. ' +
                        'Respond ONLY with a single, safe shell command that accomplishes the task. ' +
                        'No explanation, no markdown fences, no commentary. ' +
                        'Avoid destructive commands (rm -rf /, mkfs, shutdown, reboot, fork bombs). ' +
                        'Prefer non-destructive flags. If the task is unsafe, return a comment line starting with `# unsafe:` followed by a short reason.',
                },
                { role: 'user', content: prompt },
            ],
            temperature: 0.2,
            max_tokens: 256,
        });

        const raw = (completion.choices?.[0]?.message?.content || '').trim();
        // Strip markdown fences if model returned them
        const cleaned = raw
            .replace(/^```(?:bash|sh|shell)?\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();
        const safety = checkSafety(cleaned);

        res.json({
            command: cleaned,
            raw,
            safe: safety.safe,
            reason: safety.reason || null,
            model,
        });
    } catch (err: any) {
        console.error('NVIDIA AI error:', err?.message || err);
        const upstreamStatus: number = err?.status || 500;
        // Never forward a 401/403 from NVIDIA to the client. The frontend
        // treats any 401 from /api/* as a session expiry and logs the user out.
        // A 401 here simply means the stored NVIDIA API key is invalid/expired.
        let clientStatus: number;
        let message: string;
        if (upstreamStatus === 401 || upstreamStatus === 403) {
            clientStatus = 400;
            message = 'NVIDIA API key is invalid or expired. Open Terminal Settings to update it.';
        } else {
            clientStatus = upstreamStatus >= 100 && upstreamStatus < 600 ? upstreamStatus : 500;
            message = err?.message || 'Failed to reach NVIDIA LLM';
        }
        res.status(clientStatus).json({ message });
    }
});

export default router;
