import { Client as SshClient } from 'ssh2';
import { Socket } from 'socket.io';

interface SshSession {
    client: SshClient;
    stream: any;
}

const sessions = new Map<string, SshSession>();

export function registerSshSocketHandlers(socket: Socket) {
    const sid = socket.id;

    function closeSession() {
        const s = sessions.get(sid);
        if (s) {
            try { s.stream.close(); } catch { /* ignore */ }
            try { s.client.end(); } catch { /* ignore */ }
            sessions.delete(sid);
        }
    }

    socket.on('ssh:connect', ({ host, port, username, password }: {
        host: string; port?: number; username: string; password: string;
    }) => {
        closeSession();

        if (!host || !username || !password) {
            socket.emit('ssh:error', { message: 'host, username and password are required' });
            return;
        }

        const client = new SshClient();

        client.on('ready', () => {
            client.shell(
                { term: 'xterm-256color', rows: 40, cols: 160 },
                (err: any, stream: any) => {
                    if (err) {
                        socket.emit('ssh:error', { message: err.message });
                        client.end();
                        return;
                    }

                    sessions.set(sid, { client, stream });
                    socket.emit('ssh:ready', {});

                    stream.on('data', (data: Buffer) => {
                        socket.emit('ssh:output', { data: data.toString('utf8') });
                    });
                    stream.stderr?.on('data', (data: Buffer) => {
                        socket.emit('ssh:output', { data: data.toString('utf8') });
                    });
                    stream.on('close', () => {
                        sessions.delete(sid);
                        socket.emit('ssh:closed', {});
                        client.end();
                    });
                }
            );
        });

        client.on('error', (err: any) => {
            socket.emit('ssh:error', { message: err.message || 'SSH connection failed' });
        });

        client.connect({
            host,
            port: port || 22,
            username,
            password,
            readyTimeout: 15000,
        });
    });

    socket.on('ssh:input', ({ data }: { data: string }) => {
        const s = sessions.get(sid);
        if (s) {
            try { s.stream.write(data); } catch { /* ignore */ }
        }
    });

    socket.on('ssh:resize', ({ cols, rows }: { cols: number; rows: number }) => {
        const s = sessions.get(sid);
        if (s) {
            try { s.stream.setWindow(rows, cols, 0, 0); } catch { /* ignore */ }
        }
    });

    socket.on('ssh:disconnect', () => {
        closeSession();
        socket.emit('ssh:closed', {});
    });

    socket.on('disconnect', () => {
        closeSession();
    });
}
