import express from 'express';
import si from 'systeminformation';
import os from 'os';
import { authenticateToken } from '../middleware/auth';
import { emitToAuthed } from '../lib/socket';

const router = express.Router();

// Rolling history of system stats for charts
const HISTORY_LIMIT = 60;
const history: { timestamp: number; cpu: number; memory: number; load: number }[] = [];

let pollerStarted = false;

async function sampleStats() {
    try {
        const [cpu, mem, load] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.currentLoad().then(c => c.avgLoad ?? c.currentLoad),
        ]);
        const point = {
            timestamp: Date.now(),
            cpu: Math.round((cpu.currentLoad ?? 0) * 100) / 100,
            memory: mem.total > 0 ? Math.round(((mem.active / mem.total) * 100) * 100) / 100 : 0,
            load: Math.round((load ?? 0) * 100) / 100,
        };
        history.push(point);
        if (history.length > HISTORY_LIMIT) history.shift();
        emitToAuthed('system-stats', point);
    } catch (err) {
        // Silent fail — sampling will retry on next interval
    }
}

function startPoller() {
    if (pollerStarted) return;
    pollerStarted = true;
    sampleStats();
    setInterval(sampleStats, 3000);
}

startPoller();

router.get('/stats', authenticateToken, async (_req, res) => {
    try {
        const [cpu, mem, fs, load, osInfo, time, cpuInfo] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.fsSize(),
            si.currentLoad(),
            si.osInfo(),
            si.time(),
            si.cpu(),
        ]);

        const primaryDisk = (fs && fs[0]) || null;
        const totalDisk = fs.reduce((acc, f) => acc + (f.size || 0), 0);
        const usedDisk = fs.reduce((acc, f) => acc + (f.used || 0), 0);

        res.json({
            cpu: {
                load: Math.round((cpu.currentLoad ?? 0) * 100) / 100,
                cores: os.cpus().length,
                model: cpuInfo.brand || cpuInfo.manufacturer || 'Unknown',
                speed: cpuInfo.speed,
            },
            memory: {
                total: mem.total,
                used: mem.active,
                free: mem.available,
                usedPercent: mem.total > 0 ? Math.round(((mem.active / mem.total) * 10000)) / 100 : 0,
            },
            storage: {
                total: totalDisk,
                used: usedDisk,
                free: totalDisk - usedDisk,
                usedPercent: totalDisk > 0 ? Math.round(((usedDisk / totalDisk) * 10000)) / 100 : 0,
                primary: primaryDisk ? {
                    fs: primaryDisk.fs,
                    type: primaryDisk.type,
                    mount: primaryDisk.mount,
                    size: primaryDisk.size,
                    used: primaryDisk.used,
                } : null,
            },
            load: {
                avgLoad: load.avgLoad ?? load.currentLoad,
                current: load.currentLoad,
            },
            os: {
                platform: osInfo.platform,
                distro: osInfo.distro,
                release: osInfo.release,
                arch: osInfo.arch,
                hostname: osInfo.hostname,
                uptime: time.uptime,
            },
            history,
        });
    } catch (err: any) {
        console.error('System stats error:', err);
        res.status(500).json({ message: err.message || 'Failed to fetch system stats' });
    }
});

router.get('/history', authenticateToken, (_req, res) => {
    res.json({ history });
});

export default router;
