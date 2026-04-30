import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

import { getJwtSecret } from '../lib/secret';
const JWT_SECRET = getJwtSecret();

export function generateToken(payload: any) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

export function authenticateToken(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
        if (err) return res.sendStatus(403);
        (req as any).user = user;
        next();
    });
}
