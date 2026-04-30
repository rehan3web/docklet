<p align="center">
  <img src="Frontend/public/white.png" alt="Nextbase" height="60" />
</p>

<p align="center">
  <strong>Full-stack VPS management dashboard — deploy apps, manage databases, proxy domains, and control your entire server from one UI.</strong>
</p>

<p align="center">
  <a href="#-what-is-nextbase">About</a> ·
  <a href="#-features">Features</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="#-configuration">Configuration</a> ·
  <a href="#-usage-guide">Usage Guide</a> ·
  <a href="#-troubleshooting">Troubleshooting</a>
</p>

---

## What is Nextbase?

**Nextbase** started as a self-hosted PostgreSQL manager. It has since grown into a **complete VPS control panel** — all running inside Docker on your own server with no cloud dependency, no data leaving your machine, and no subscription fees.

From a single browser tab you can:

- Manage your **PostgreSQL** database (tables, SQL, schema, backups, pooling)
- Monitor your **VPS** (CPU, RAM, disk, network)
- Talk to an **AI assistant** powered by NVIDIA LLMs directly in your terminal
- Manage **Docker** containers, images, and volumes
- **Deploy apps** from any public GitHub repo containing a Dockerfile
- Map **custom domains** to deployed apps with automatic DNS verification and free Let's Encrypt SSL

---

## Features

### Database Management
| Feature | Description |
|---|---|
| **Dashboard** | Real-time database stats — size, connections, uptime, table count |
| **Table Editor** | Create tables, insert / edit / delete rows with an inline grid |
| **SQL Editor** | Full SQL query editor with syntax highlighting and result pane |
| **Schema Visualizer** | Interactive diagram of all tables with FK relationship lines |
| **Statistics & Charts** | Query performance, connection trends, and database activity graphs |
| **Backup & Restore** | One-click `pg_dump` backups and `pg_restore` — stored on your server |
| **Pause / Resume** | Suspend all external connections (stops pgBouncer + locks DB) |
| **Expose Public** | HAProxy TCP proxy — toggle public Postgres access on port 5432 / 6543 |
| **Connection Pooling** | pgBouncer sits in front of Postgres for production-grade pooling |

### VPS & Infrastructure
| Feature | Description |
|---|---|
| **VPS Management** | Live CPU, RAM, disk, and network graphs for your entire server |
| **AI Terminal** | Chat with NVIDIA-hosted LLMs (Llama 3, Mistral, etc.) in a browser terminal |
| **Docker Manager** | View, start, stop, remove containers; inspect images and volumes |
| **GitHub Auto Deploy** | Paste a public repo URL → Nextbase clones, builds the Dockerfile, starts the container, and assigns a port via HAProxy |
| **Reverse Proxy Manager** | Map a domain to any running container port. Nextbase writes the nginx config, verifies DNS, and provisions a free Let's Encrypt TLS certificate automatically |

---

## Prerequisites

- **Docker** ≥ 24 — [Install Docker](https://docs.docker.com/engine/install/)
- **Docker Compose** ≥ 2 (ships with Docker Desktop, or install the plugin)
- **Git**
- Firewall open for port **3000** (web UI), **80** and **443** (reverse proxy)
- A domain (or subdomain) with DNS A-record pointing to your server IP for each app you want to expose via HTTPS

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/rehan3web/nextbase.git nextbase
cd nextbase
```

### 2. Create your `.env` file

```bash
cp .env.example .env
nano .env
```

```env
# PostgreSQL database
DB_NAME=mydb
DB_USERNAME=myuser
DB_PASSWORD=StrongPassword123!

# Nextbase admin login (web UI)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=SecureAdminPass!

# JWT secret — generate with: openssl rand -hex 32
JWT_SECRET=replace_with_a_64_char_random_string
```

> **Never commit `.env` to Git.** It is already in `.gitignore`.

### 3. Start everything

```bash
docker compose -f postgres.yml up -d --build
```

### 4. Open the web UI

```
http://your-server-ip:3000
```

Log in with the `ADMIN_USERNAME` and `ADMIN_PASSWORD` you set in `.env`.

---

## Architecture

```
                 ┌─────────────────────────────────────────────────────┐
                 │                     Your Server                      │
                 │                                                       │
  Browser ──────►  :3000   Nextbase Frontend  (React / Vite)           │
                 │               │                                       │
                 │               ▼                                       │
                 │  :3001   Nextbase Backend  (Node / Express)          │
                 │               │                                       │
                 │    ┌──────────┼──────────────────────┐               │
                 │    ▼          ▼           ▼           ▼               │
                 │  pgBouncer  Postgres   docker.sock   nginx            │
                 │  :16543     :15432     (Docker API)  :80/:443         │
                 │                                        │               │
                 │                              nextbase-haproxy         │
                 │                              :8000–:8098 (internal)   │
                 │                                        │               │
                 │                              Deployed containers      │
                 │                              (nextbase-apps network)  │
                 └─────────────────────────────────────────────────────┘
```

### Reverse Proxy flow (domain → app)

```
Internet ──► nginx :80/:443 ──► nextbase-haproxy:PORT ──► container:EXPOSE_PORT
```

nginx and HAProxy communicate over the internal Docker bridge — HAProxy has no publicly exposed ports.

### Service map

| Service | Container | Port | Purpose |
|---|---|---|---|
| Frontend | `dbofather-client` | 3000 | React web UI |
| Backend | `dbofather-server` | 3001 | REST API + Docker control |
| pgBouncer | `dbofather-pooler` | 16543 | Connection pooler |
| PostgreSQL | `dbofather-db` | 15432 | Database |
| DB HAProxy | `dbofather-proxy` | 5432 / 6543 | Public TCP proxy (optional) |
| App HAProxy | `nextbase-haproxy` | 8000–8098 (internal) | Per-app port proxy |
| Nginx | `nextbase-nginx` | 80 / 443 | Domain → HTTPS reverse proxy |

---

## Configuration

All configuration lives in **`.env`** in the project root.

| Variable | Description | Example |
|---|---|---|
| `DB_NAME` | PostgreSQL database name | `mydb` |
| `DB_USERNAME` | PostgreSQL user | `myuser` |
| `DB_PASSWORD` | PostgreSQL password | `StrongPass!` |
| `ADMIN_USERNAME` | Nextbase web UI username | `admin` |
| `ADMIN_PASSWORD` | Nextbase web UI password | `SecurePass!` |
| `JWT_SECRET` | Secret for signing login tokens | 64-char random string |

Generate a strong JWT secret:

```bash
openssl rand -hex 32
```

---

## Usage Guide

### Database Dashboard

Live overview of your PostgreSQL instance — database size, table count, active connections, uptime, PostgreSQL version, and recent query activity.

### Table Editor

Browse all tables. Select a table to view, insert, edit, and delete rows. Create new tables with a full column builder (all PostgreSQL types, PRIMARY KEY, DEFAULT, NOT NULL, UNIQUE).

### SQL Editor

Write and run raw SQL with syntax highlighting. Results appear in a scrollable grid with error messages that include line numbers.

### Schema Visualizer

Interactive diagram of your schema. Tables are draggable cards. Foreign-key relationships are drawn as animated arrows with column labels. Zoom, pan, and search by table name.

### Statistics

Charts for active connections, query throughput, cache hit ratio, and table sizes — updated live.

### Backup & Restore

- **Create Backup** — runs `pg_dump` and stores the file in `./backups/`
- **Download** — download any backup to your local machine
- **Restore** — upload a `.sql` or `.dump` file to restore

### Pause / Resume

**Pause** blocks all external connections (`ALLOW_CONNECTIONS false` + pgBouncer stop + active connection kill). **Resume** restores full access. The Nextbase backend remains connected throughout so the UI keeps working.

### VPS Management

Real-time server metrics — CPU usage per core, total / used / free RAM, disk usage per mount, and network I/O graphs. No agent required; data is read from `/proc` via the backend container.

### AI Terminal

Chat interface connected to NVIDIA-hosted LLMs (Llama 3.1, Mistral, and others). Ask questions about your server, generate SQL, debug configs, or get DevOps help — all without leaving the dashboard.

### Docker Manager

Full Docker control from the browser:
- View all containers with status, image, ports, and uptime
- Start / stop / restart / remove containers
- Browse images and volumes
- Tail container logs in real time

### GitHub Auto Deploy

1. Paste any public GitHub repo URL that contains a `Dockerfile`
2. Nextbase clones it, builds the image, starts the container on the internal `nextbase-apps` network, and assigns an HAProxy port (8000–8098)
3. Watch the live build log stream in the UI
4. Map a domain to the assigned port via the Reverse Proxy manager

### Reverse Proxy Manager

Turn any deployed container into a public HTTPS endpoint:

1. **Add Domain** — enter your domain (e.g. `app.example.com`) and the HAProxy port the app was assigned
2. **DNS Verification** — Nextbase checks the domain's A-record matches your server IP
3. **Enable SSL** — runs Certbot (Let's Encrypt) in webroot mode. Certificate is stored in `./letsencrypt/` and nginx is reloaded automatically
4. Your app is live at `https://app.example.com` — certificate auto-renews

---

## Updating

Pull the latest changes and rebuild:

```bash
git pull
docker compose -f postgres.yml build
docker compose -f postgres.yml up -d
```

Your PostgreSQL data is in the `pgdata` Docker volume and is never affected by updates.

---

## Reset Password

If you forget your admin credentials, edit `.env` and restart:

```bash
nano .env   # change ADMIN_USERNAME / ADMIN_PASSWORD
docker compose -f postgres.yml up -d --force-recreate dbcraft-server
```

Or follow the built-in guide at `/forgot-password` in the UI.

---

## Stopping & Removing

**Stop all services (keep data):**

```bash
docker compose -f postgres.yml down
```

**Stop and remove all data (irreversible):**

```bash
docker compose -f postgres.yml down -v
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| UI not loading on port 3000 | Check `docker ps` — make sure `dbofather-client` is running |
| Login fails | Verify `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` and restart |
| Database not accepting connections | Check if paused — click **Resume** in the UI |
| Backup fails | Ensure Docker socket is mounted (`/var/run/docker.sock`) |
| Can't connect external DB client | Click **Expose Public** on the dashboard and allow ports 5432 / 6543 in your firewall |
| Domain shows 502 | Ensure HAProxy config has a listen block for the app's port — run a fresh deploy to trigger a config write |
| SSL fails | Confirm the domain's A-record points to your server IP before clicking Enable SSL |
| Docker deploy fails | Ensure the repo contains a `Dockerfile` and is public |

View logs for any service:

```bash
docker logs dbofather-server     # backend API
docker logs dbofather-client     # frontend
docker logs dbofather-db         # postgres
docker logs dbofather-pooler     # pgbouncer
docker logs nextbase-haproxy     # app proxy
docker logs nextbase-nginx       # reverse proxy
```

---

## License

This project is licensed under the terms in [LICENSE](./LICENSE).

---

<p align="center">Built with PostgreSQL · pgBouncer · HAProxy · nginx · Node.js · React · Docker · NVIDIA LLMs</p>
