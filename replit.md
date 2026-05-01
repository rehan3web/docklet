# Nextbase — PostgreSQL Management Dashboard

## Overview
Nextbase is a self-hosted, full-stack PostgreSQL management tool — a lightweight, privacy-focused alternative to Supabase Studio or pgAdmin. It allows developers to manage their PostgreSQL infrastructure through a modern web interface.

## Features
- **Table Editor**: Visual grid for CRUD operations and column builder
- **SQL Editor**: Syntax-highlighted editor with result pane
- **Schema Visualizer**: Interactive ERD diagram showing table relationships
- **Database Statistics**: Real-time monitoring of size, connections, throughput, cache hit ratio
- **Backup & Restore**: pg_dump and pg_restore support via UI
- **Connection Pooling**: pgBouncer integration
- **Authentication**: JWT-based admin login
- **VPS Management**: Live CPU/RAM/Storage/Load charts streamed via Socket.IO every 3s with 60-point rolling history
- **AI Terminal**: Shell command runner with NVIDIA LLM integration (user-supplied API key, AES-GCM encrypted at rest), live WS-streamed output, command suggestions, dangerous-command safety guards requiring explicit "I CONFIRM" confirmation
- **Docker Manager**: Container start/stop/restart/remove + bulk actions via dockerode (gracefully reports unavailable when Docker is not installed)
- **Container Environment Variables**: Per-container env var storage (AES-256-CBC encrypted at rest), with "Apply & Restart" that reconstructs the container from docker inspect + merged env.
- **Container Scheduler**: Per-container cron jobs (node-cron) that run commands via `docker exec`. Create/edit/delete/toggle, manual run, per-schedule log history.
- **Container Domain Routing**: Base-domain DNS verification (A + wildcard), auto-generated subdomains (`app-<hex>.domain.com`), nginx config written to shared bind-mount volume, per-container routing.
- **Container Backups**: Schedule-based or manual backup via `docker export` → gzip → S3/MinIO upload. Keep-N rotation, per-backup log history, S3 file browser, restore from S3 key. Requires storage (MinIO) to be configured.
- **GitHub Auto Deploy**: Clone Git repo → detect Dockerfile → docker build → docker run; live deployment logs streamed per-user via Socket.IO
- **Reverse Proxy Manager**: Map domain → target port (nginx config generated, written to `nginx-configs/`). DNS A-record verification via `dns.promises.resolve4`. Let's Encrypt SSL via certbot (`docker run --volumes-from dbofather-server certbot/certbot`). Status flow: Pending DNS → Verified → SSL Active. Nginx container (`nextbase-nginx`, `network_mode: host`) auto-reloaded after every change.

## Security Model
- **REST API**: All `/api/*` routes (except `/auth`, `/health`) require a valid JWT bearer token.
- **WebSocket**: Socket.IO handshake middleware verifies JWT and rejects unauthenticated connections. Each authenticated socket joins:
  - `authenticated` room (for non-sensitive global broadcasts like system stats)
  - `user:<id>` room (for per-user scoped events: terminal output, deploy logs)
- **Per-user isolation**: Terminal output and deploy log/status events are emitted to the originating user's room only (never broadcast). Deploy listing/detail filter by owner.
- **Secret encryption at rest**: NVIDIA API key (and any future secret keys listed in `SECRET_KEYS`) is AES-256-GCM encrypted before persistence in `nextbase_settings`. Encryption key is derived from `JWT_SECRET` via SHA-256. Legacy plaintext rows are auto-migrated on first read.
- **Command safety**: Regex-based dangerous-command detector blocks (or requires `"I CONFIRM"` for) `rm -rf /`, `mkfs`, `dd if=…`, fork bombs, shutdown/reboot, etc.

## Architecture

### Frontend (`/Frontend`)
- **Framework**: React 18 + Vite
- **Styling**: Tailwind CSS v4
- **UI Components**: Radix UI + Lucide icons
- **State/Data**: TanStack Query
- **Routing**: wouter
- **Visualization**: @xyflow/react (React Flow)
- **Forms**: react-hook-form + zod
- **Dev Port**: 5000 (0.0.0.0)

### Backend (`/Backend`)
- **Runtime**: Node.js 20 + TypeScript
- **Framework**: Express v5
- **Database**: pg (node-postgres)
- **Auth**: JWT (jsonwebtoken) + bcryptjs
- **Real-time**: socket.io
- **Dev Port**: 3001 (localhost)
- **API Proxy**: Vite proxies `/api` → `http://127.0.0.1:3001`

## Workflows
- **Start application**: `cd Frontend && npm run dev` (webview, port 5000)
- **Backend**: `cd Backend && npx ts-node src/index.ts` (console)

## Environment Variables
- `DATABASE_URL`: PostgreSQL connection string (Replit managed)
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`: PostgreSQL credentials
- `JWT_SECRET`: Secret for JWT token signing
- `ADMIN_USERNAME`: Admin login username (default: admin)
- `ADMIN_PASSWORD`: Admin login password (default: admin123)
- `BACKEND_PORT`: Backend server port (default: 3001)
- `NODE_ENV`: Environment (development/production)

## Development Login
- Username: `admin`
- Password: `admin123`

## Key Files
- `Frontend/vite.config.ts`: Vite config with API proxy and host settings
- `Backend/src/index.ts`: Express server entry point
- `Backend/src/lib/db.ts`: PostgreSQL connection pool
- `Backend/src/lib/config.ts`: Config loader (postgres.yml + .env)
- `Backend/src/routes/`: auth, db, query, admin, system, terminal, docker, deploy, proxy route handlers
- `Backend/src/lib/socket.ts`: Shared Socket.IO instance + scoped emission helpers (`emitToUser`, `emitToAuthed`, `emitTo`)
- `Backend/src/lib/safety.ts`: Dangerous-command regex patterns + curated command suggestions
- `Backend/src/lib/settings.ts`: Postgres-backed key/value store with automatic encryption for secret keys
- `Backend/src/lib/crypto.ts`: AES-256-GCM helpers used to encrypt secrets at rest
- `Frontend/src/api/socket.ts`: Singleton Socket.IO client that auto-attaches the JWT in the handshake
- `Frontend/src/pages/{vps,terminal,docker,deploy,proxy}.tsx`: Feature pages
- `postgres.yml`: Docker Compose config — includes `nextbase-nginx` (host-network nginx), `nextbase-haproxy` (8000-8098), `dbofather-server` (backend)
- `nginx-configs/`: nginx per-domain `.conf` files auto-written by the backend; `default.conf` is the catch-all placeholder
- `letsencrypt/`: bind-mounted into backend + nginx containers; certbot writes certs here
- `certbot-webroot/`: bind-mounted ACME challenge directory served by nginx at `/.well-known/acme-challenge/`
