import express from 'express';
import { generateToken, authenticateToken } from '../middleware/auth';
import { loadConfig, saveConfig } from '../lib/config';

const router = express.Router();

router.get('/config', (req, res) => {
    res.json({ username: process.env.ADMIN_USERNAME });
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const config = loadConfig();

    // Fallback: Check process.env first, then postgres.yml anchors
    const envUser = (process.env.ADMIN_USERNAME || config?.['x-admin-user'] || '').toString().trim();
    const envPass = (process.env.ADMIN_PASSWORD || config?.['x-admin-pass'] || '').toString().trim();

    const inputUser = (username || '').toString().trim();
    const inputPass = (password || '').toString().trim();

    console.log('Login debug:', {
        inputUser,
        expectedUser: envUser,
        configKeys: config ? Object.keys(config) : 'null',
        inputUserLen: inputUser.length,
        expectedUserLen: envUser.length,
        inputPassLen: inputPass.length,
        expectedPassLen: envPass.length,
        match: inputUser === envUser && inputPass === envPass
    });

    if (inputUser === envUser && inputPass === envPass) {
        const token = generateToken({ username: inputUser });
        return res.json({ token, user: { username: inputUser } });
    }

    res.status(401).json({ message: 'Invalid credentials' });
});

router.post('/change-password', authenticateToken, async (req, res) => {
    res.status(400).json({ message: 'Password changes are managed via postgres.yml (x-admin-pass).' });
});

router.get('/me', authenticateToken, (req, res) => {
    res.json({ user: (req as any).user });
});

export default router;
