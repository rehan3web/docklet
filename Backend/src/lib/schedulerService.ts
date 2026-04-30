import * as cron from 'node-cron';
import { executeQuery } from './db';
import { exec } from 'child_process';

interface ScheduledTask {
    id: number;
    name: string;
    cron_expr: string;
    timezone: string | null;
    script: string;
    enabled: boolean;
}

const jobs = new Map<number, ReturnType<typeof cron.schedule>>();

export async function initScheduler() {
    try {
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS scheduled_tasks (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                cron_expr TEXT NOT NULL,
                timezone TEXT,
                script TEXT NOT NULL,
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
                updated_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
            )
        `);
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS task_runs (
                id SERIAL PRIMARY KEY,
                task_id INTEGER NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
                started_at BIGINT NOT NULL,
                finished_at BIGINT,
                status TEXT NOT NULL DEFAULT 'running',
                output TEXT NOT NULL DEFAULT '',
                exit_code INTEGER
            )
        `);

        const { rows } = await executeQuery(
            'SELECT * FROM scheduled_tasks WHERE enabled = TRUE'
        );
        for (const task of rows as ScheduledTask[]) {
            scheduleTask(task);
        }
        console.log(`[Scheduler] Initialized — ${rows.length} task(s) loaded`);
    } catch (err: any) {
        console.error('[Scheduler] Init error:', err.message);
    }
}

export function scheduleTask(task: ScheduledTask) {
    if (jobs.has(task.id)) {
        jobs.get(task.id)!.stop();
        jobs.delete(task.id);
    }
    if (!task.enabled) return;
    if (!cron.validate(task.cron_expr)) {
        console.warn(`[Scheduler] Invalid cron for task ${task.id}: ${task.cron_expr}`);
        return;
    }

    const opts: { scheduled: boolean; timezone?: string } = { scheduled: true };
    if (task.timezone) opts.timezone = task.timezone;

    const job = cron.schedule(task.cron_expr, () => {
        runTaskScript(task);
    }, opts);

    jobs.set(task.id, job);
    console.log(`[Scheduler] Scheduled task ${task.id} "${task.name}" @ ${task.cron_expr}`);
}

export function unscheduleTask(id: number) {
    if (jobs.has(id)) {
        jobs.get(id)!.stop();
        jobs.delete(id);
    }
}

export async function runTaskScript(task: ScheduledTask): Promise<number> {
    const startedAt = Date.now();
    const { rows } = await executeQuery(
        `INSERT INTO task_runs (task_id, started_at, status, output) VALUES ($1, $2, 'running', '') RETURNING id`,
        [task.id, startedAt]
    );
    const runId: number = rows[0].id;

    return new Promise((resolve) => {
        let output = '';
        const child = exec(task.script, { timeout: 5 * 60 * 1000 });

        child.stdout?.on('data', (d) => { output += d; });
        child.stderr?.on('data', (d) => { output += d; });

        child.on('close', async (code) => {
            const finishedAt = Date.now();
            const status = code === 0 ? 'success' : 'failed';
            await executeQuery(
                `UPDATE task_runs SET finished_at=$1, status=$2, output=$3, exit_code=$4 WHERE id=$5`,
                [finishedAt, status, output, code, runId]
            );
            resolve(runId);
        });

        child.on('error', async (err) => {
            const finishedAt = Date.now();
            await executeQuery(
                `UPDATE task_runs SET finished_at=$1, status='failed', output=$2, exit_code=-1 WHERE id=$3`,
                [finishedAt, err.message, runId]
            );
            resolve(runId);
        });
    });
}
