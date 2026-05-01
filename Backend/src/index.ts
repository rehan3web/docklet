import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth';
import dbRoutes from './routes/db';
import queryRoutes from './routes/query';
import adminRoutes from './routes/admin';
import systemRoutes from './routes/system';
import terminalRoutes from './routes/terminal';
import dockerRoutes from './routes/docker';
import deployRoutes from './routes/deploy';
import proxyRoutes from './routes/proxy';
import schedulerRoutes from './routes/scheduler';
import storageRoutes from './routes/storage';
import containerMgmtRoutes, { initContainerManagement } from './routes/containerManagement';
import domainsRoutes from './routes/domains';
import { registerSshSocketHandlers } from './routes/ssh';
import { registerDockerExecSocketHandlers } from './routes/docker';
import { setIo } from './lib/socket';
import { initScheduler } from './lib/schedulerService';

dotenv.config();

// ── Global crash guards ────────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception — keeping process alive:', err.message);
});
process.on('unhandledRejection', (reason: any) => {
    console.error('[FATAL] Unhandled promise rejection — keeping process alive:', reason?.message ?? reason);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

setIo(io);

app.use(cors());
app.use(express.json({ limit: '20mb' }));

// ── Rate limiting ──────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30,                   // 30 attempts per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many login attempts. Please try again later.' },
});

const statsLimiter = rateLimit({
    windowMs: 10 * 1000,       // 10 seconds
    max: 60,                   // 60 stat requests per 10s (one per container per tick)
    standardHeaders: true,
    legacyHeaders: false,
});

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/docker/containers', statsLimiter);
app.use('/api/db', dbRoutes);
app.use('/api/query', queryRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/terminal', terminalRoutes);
app.use('/api/docker', dockerRoutes);
app.use('/api/deploy', deployRoutes);
app.use('/api/proxy', proxyRoutes);
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/mgmt', containerMgmtRoutes);
app.use('/api/domains', domainsRoutes);

// ── Socket.IO JWT handshake middleware ────────────────────────────────────────
// Reject any socket that does not present a valid bearer token. Authenticated
// sockets are auto-joined to the `authenticated` room and a per-user room
// `user:<id>` so that sensitive emissions (terminal output, deploy logs) can
// be scoped to the originating user only.
import { getJwtSecret } from './lib/secret';
const JWT_SECRET = getJwtSecret();
io.use((socket, next) => {
    try {
        const token =
            (socket.handshake.auth && (socket.handshake.auth as any).token) ||
            (typeof socket.handshake.headers.authorization === 'string'
                ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
                : undefined) ||
            (socket.handshake.query && (socket.handshake.query as any).token);
        if (!token || typeof token !== 'string') {
            return next(new Error('Unauthorized: missing token'));
        }
        const payload: any = jwt.verify(token, JWT_SECRET);
        (socket.data as any).user = payload;
        (socket.data as any).userId = payload?.id ?? payload?.username ?? 'anonymous';
        next();
    } catch (err: any) {
        next(new Error('Unauthorized: ' + (err?.message || 'invalid token')));
    }
});

io.on('connection', (socket) => {
    const userId: string = (socket.data as any).userId;
    socket.join('authenticated');
    socket.join(`user:${userId}`);
    console.log(`Client connected: ${socket.id} (user=${userId})`);

    registerSshSocketHandlers(socket);
    registerDockerExecSocketHandlers(socket);

    socket.on('subscribe-table', (tableName) => {
        if (typeof tableName === 'string' && /^[a-zA-Z0-9_.-]+$/.test(tableName)) {
            socket.join(`table-${tableName}`);
        }
    });
    // Note: there is no `subscribe-deploy` handler. Deployment logs and
    // status events are emitted exclusively to the deployment owner's
    // private `user:<id>` room (see Backend/src/routes/deploy.ts), so a
    // generic deploy-room subscription would only widen the attack surface.
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id} (user=${userId})`);
    });
});

export const broadcastSchemaChange = () => {
    io.emit('schema-changed');
};

export const broadcastTableUpdate = (tableName: string) => {
    io.to(`table-${tableName}`).emit('table-updated', { tableName });
};

const PORT = process.env.BACKEND_PORT || 3001;

server.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Backend running on port ${PORT}`);
    initScheduler();
    initContainerManagement().catch(err => console.error('[ContainerMgmt] Init failed:', err.message));
});
