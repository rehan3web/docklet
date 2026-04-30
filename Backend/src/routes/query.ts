import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { executeQuery } from '../lib/db';

const router = express.Router();

router.post('/run', authenticateToken, async (req, res) => {
    const { sql, params } = req.body;
    if (!sql) return res.status(400).json({ message: 'SQL query is required' });

    try {
        const result = await executeQuery(sql, params);
        res.json(result);
    } catch (error: any) {
        res.status(400).json(error);
    }
});

export default router;
