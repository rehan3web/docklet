import express from 'express';
import { executeQuery } from '../lib/db';
import { authenticateToken } from '../middleware/auth';
import { scheduleTask, unscheduleTask, runTaskScript } from '../lib/schedulerService';
import * as cron from 'node-cron';

const router = express.Router();
router.use(authenticateToken);

// ── List all tasks ────────────────────────────────────────────────────────────
router.get('/tasks', async (_req, res) => {
    const { rows } = await executeQuery(
        'SELECT * FROM scheduled_tasks ORDER BY created_at DESC'
    );
    res.json({ tasks: rows });
});

// ── Create task ───────────────────────────────────────────────────────────────
router.post('/tasks', async (req, res) => {
    const { name, cron_expr, timezone, script, enabled = true } = req.body;
    if (!name || !cron_expr || !script) {
        return res.status(400).json({ message: 'name, cron_expr, and script are required' });
    }
    if (!cron.validate(cron_expr)) {
        return res.status(400).json({ message: 'Invalid cron expression' });
    }
    const now = Date.now();
    const { rows } = await executeQuery(
        `INSERT INTO scheduled_tasks (name, cron_expr, timezone, script, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *`,
        [name, cron_expr, timezone || null, script, enabled, now]
    );
    const task = rows[0];
    if (task.enabled) scheduleTask(task);
    res.json({ task });
});

// ── Update task ───────────────────────────────────────────────────────────────
router.patch('/tasks/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, cron_expr, timezone, script, enabled } = req.body;
    if (cron_expr && !cron.validate(cron_expr)) {
        return res.status(400).json({ message: 'Invalid cron expression' });
    }
    const { rows } = await executeQuery(
        `UPDATE scheduled_tasks
         SET name = COALESCE($1, name),
             cron_expr = COALESCE($2, cron_expr),
             timezone = COALESCE($3, timezone),
             script = COALESCE($4, script),
             enabled = COALESCE($5, enabled),
             updated_at = $6
         WHERE id = $7 RETURNING *`,
        [name ?? null, cron_expr ?? null, timezone ?? null, script ?? null, enabled ?? null, Date.now(), id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Task not found' });
    const task = rows[0];
    if (task.enabled) {
        scheduleTask(task);
    } else {
        unscheduleTask(id);
    }
    res.json({ task });
});

// ── Delete task ───────────────────────────────────────────────────────────────
router.delete('/tasks/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    unscheduleTask(id);
    await executeQuery('DELETE FROM scheduled_tasks WHERE id = $1', [id]);
    res.json({ ok: true });
});

// ── Run task manually ─────────────────────────────────────────────────────────
router.post('/tasks/:id/run', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { rows } = await executeQuery('SELECT * FROM scheduled_tasks WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Task not found' });
    const task = rows[0];
    const runId = await runTaskScript(task);
    res.json({ runId });
});

// ── List runs for a task ──────────────────────────────────────────────────────
router.get('/tasks/:id/runs', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { rows } = await executeQuery(
        'SELECT * FROM task_runs WHERE task_id = $1 ORDER BY started_at DESC LIMIT 50',
        [id]
    );
    res.json({ runs: rows });
});

// ── Get single run (logs) ─────────────────────────────────────────────────────
router.get('/runs/:runId', async (req, res) => {
    const { rows } = await executeQuery(
        'SELECT * FROM task_runs WHERE id = $1',
        [parseInt(req.params.runId, 10)]
    );
    if (!rows.length) return res.status(404).json({ message: 'Run not found' });
    res.json({ run: rows[0] });
});

export default router;
