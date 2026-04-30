import type { Server } from 'socket.io';

let ioInstance: Server | null = null;

export function setIo(io: Server) {
    ioInstance = io;
}

export function getIo(): Server | null {
    return ioInstance;
}

export function emitTo(room: string, event: string, payload: any) {
    if (ioInstance) ioInstance.to(room).emit(event, payload);
}

/**
 * Emit only to authenticated users — never to unauthenticated sockets.
 * The `authenticated` room is auto-joined in the JWT handshake middleware.
 */
export function emitToAuthed(event: string, payload: any) {
    if (ioInstance) ioInstance.to('authenticated').emit(event, payload);
}

/**
 * Emit to a single user's private room (per-user isolation for sensitive
 * streams like terminal output, deployment logs, etc.).
 */
export function emitToUser(userId: string | number, event: string, payload: any) {
    if (ioInstance) ioInstance.to(`user:${userId}`).emit(event, payload);
}

/**
 * Legacy broad-cast — kept only for non-sensitive global events. Avoid for
 * anything user/tenant scoped. Prefer emitToAuthed/emitToUser instead.
 */
export function emitAll(event: string, payload: any) {
    if (ioInstance) ioInstance.emit(event, payload);
}
