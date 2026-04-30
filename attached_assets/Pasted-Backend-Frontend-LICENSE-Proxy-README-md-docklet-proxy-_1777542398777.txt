Backend  Frontend  LICENSE  Proxy  README.md  docklet-proxy.cfg  haproxy.cfg  nginx-configs  nginx-tcp.conf  postgres.yml  replit.md  start.sh
root@root:~/docklet# nano .env
root@root:~/docklet# docker compose -f postgres.yml up --build -d
[+] up 44/44
 ✔ Image haproxy:alpine           Pulled                                                                                                                  5.5s
 ✔ Image edoburu/pgbouncer:latest Pulled                                                                                                                  3.9s
 ✔ Image nginx:alpine             Pulled                                                                                                                  6.3s
 ✔ Image postgres:15              Pulled                                                                                                                 12.4s
[+] Building 63.4s (28/28) FINISHED                                                                                                                           
 => [internal] load local bake definitions                                                                                                               0.0s
 => => reading from stdin 967B                                                                                                                           0.0s
 => [docklet-client internal] load build definition from Dockerfile                                                                                      0.0s
 => => transferring dockerfile: 307B                                                                                                                     0.0s
 => [docklet-server internal] load build definition from Dockerfile                                                                                      0.0s
 => => transferring dockerfile: 269B                                                                                                                     0.0s
 => [docklet-client internal] load metadata for docker.io/library/node:20-alpine                                                                         1.0s
 => [docklet-client internal] load metadata for docker.io/library/nginx:alpine                                                                           0.0s
 => [docklet-server internal] load .dockerignore                                                                                                         0.0s
 => => transferring context: 87B                                                                                                                         0.0s
 => [docklet-client internal] load .dockerignore                                                                                                         0.0s
 => => transferring context: 79B                                                                                                                         0.0s
 => [docklet-server build 1/6] FROM docker.io/library/node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293             2.9s
 => => resolve docker.io/library/node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293                                  0.1s
 => => sha256:b2cbbfe903b0821005780971ddc5892edcc4ce74c5a48d82e1d2b382edac3122 1.26MB / 1.26MB                                                           0.2s
 => => sha256:fff4e2c1b189bf87d63ad8bd07f7f4eb288d6f2b6a07a8bb44c60e8c075d2096 445B / 445B                                                               0.3s
 => => sha256:4feea04c154301db6f4a496efa397b3db96603b1c009c797cfdde77bea8b3287 43.23MB / 43.23MB                                                         0.9s
 => => extracting sha256:4feea04c154301db6f4a496efa397b3db96603b1c009c797cfdde77bea8b3287                                                                1.6s
 => => extracting sha256:b2cbbfe903b0821005780971ddc5892edcc4ce74c5a48d82e1d2b382edac3122                                                                0.1s
 => => extracting sha256:fff4e2c1b189bf87d63ad8bd07f7f4eb288d6f2b6a07a8bb44c60e8c075d2096                                                                0.0s
 => [docklet-client internal] load build context                                                                                                         0.1s
 => => transferring context: 1.85MB                                                                                                                      0.1s
 => [docklet-client stage-1 1/3] FROM docker.io/library/nginx:alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de             0.3s
 => => resolve docker.io/library/nginx:alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de                                    0.1s
 => [docklet-server internal] load build context                                                                                                         0.1s
 => => transferring context: 222.50kB                                                                                                                    0.0s
 => [docklet-server 2/7] RUN apk add --no-cache postgresql-client docker-cli docker-compose bash git                                                     3.4s
 => [docklet-client build 2/6] WORKDIR /app                                                                                                              0.5s
 => [docklet-client build 3/6] COPY package*.json ./                                                                                                     0.1s
 => [docklet-client build 4/6] RUN npm install                                                                                                          29.2s
 => [docklet-server 3/7] WORKDIR /usr/src/app                                                                                                            0.1s 
 => [docklet-server 4/7] COPY package*.json ./                                                                                                           0.1s 
 => [docklet-server 5/7] RUN npm install                                                                                                                11.7s
 => [docklet-server 6/7] COPY . .                                                                                                                        0.2s
 => [docklet-server 7/7] RUN npm run build                                                                                                              15.0s
 => [docklet-client build 5/6] COPY . .                                                                                                                  0.4s
 => [docklet-client build 6/6] RUN npm run build                                                                                                        27.5s
 => [docklet-server] exporting to image                                                                                                                 20.4s
 => => exporting layers                                                                                                                                 14.9s
 => => exporting manifest sha256:611d12818b100e01ec84b3e49cc24d0773265217131b4db4f6bcfa953e83cb50                                                        0.0s
 => => exporting config sha256:39b8029ab494cf08042beb015ebb5166abfac46f83bafd242225f646ec5afa08                                                          0.0s
 => => exporting attestation manifest sha256:363ed14876c14d9e816a528ce8da2475881284f10d9148aee47961a00e6d6e9a                                            0.0s
 => => exporting manifest list sha256:49452f71e045c69a93909cfd1412203daa5825f75abdfea09c4c7b72f6a047e2                                                   0.0s
 => => naming to docker.io/library/docklet-docklet-server:latest                                                                                         0.0s
 => => unpacking to docker.io/library/docklet-docklet-server:latest                                                                                      5.2s
 => [docklet-server] resolving provenance for metadata file                                                                                              0.1s
 => [docklet-client stage-1 2/3] COPY --from=build /app/dist /usr/share/nginx/html                                                                       0.1s
 => [docklet-client stage-1 3/3] COPY nginx.conf /etc/nginx/conf.d/default.conf                                                                          0.0s
 => [docklet-client] exporting to image                                                                                                                  0.6s
 => => exporting layers                                                                                                                                  0.3s
 => => exporting manifest sha256:0edf73527dba51ef18850c32b1324bade2724c3bd2dede1ba2be6846741954c6                                                        0.0s
 => => exporting config sha256:9801b205e46051bad6fe0003a7828edb5cc2aff6c6c9af049a20490f3de5098c                                                          0.0s
[+] up 55/55ting attestation manifest sha256:f4ccc8be3a4a8b2146f2569511b6589cf4b8143f61ef698cb5313c811f920428                                            0.0s
 ✔ Image haproxy:alpine           Pulled                                                                                                                  5.5s
 ✔ Image edoburu/pgbouncer:latest Pulled                                                                                                                  3.9s
 ✔ Image nginx:alpine             Pulled                                                                                                                  6.3s
 ✔ Image postgres:15              Pulled                                                                                                                 12.4s
 ✔ Image docklet-docklet-client   Built                                                                                                                  63.6s
 ✔ Image docklet-docklet-server   Built                                                                                                                  63.6s
 ✔ Network docklet_default        Created                                                                                                                 0.1s
 ✔ Network docklet-apps           Created                                                                                                                 0.1s
 ✔ Volume docklet_pgdata          Created                                                                                                                 0.0s
 ✔ Container docklet-db           Healthy                                                                                                                11.3s
 ✔ Container docklet-pooler       Started                                                                                                                11.5s
 ✔ Container docklet-server       Started                                                                                                                11.7s
 ✔ Container docklet-nginx        Started                                                                                                                12.4s
 ✔ Container docklet-client       Started                                                                                                                12.3s
 ✔ Container docklet-haproxy      Started                                                                                                                12.2s
root@root:~/docklet# docker ps
CONTAINER ID   IMAGE                      COMMAND                  CREATED         STATUS                         PORTS                                                                          NAMES
5ccc822f3d1a   nginx:alpine               "/docker-entrypoint.…"   3 minutes ago   Up 2 minutes                   0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, [::]:443->443/tcp   docklet-nginx
ed64f3a7da1b   haproxy:alpine             "docker-entrypoint.s…"   3 minutes ago   Up 2 minutes                                                                                                  docklet-haproxy
8dddf735add3   docklet-docklet-client     "/docker-entrypoint.…"   3 minutes ago   Restarting (1) 6 seconds ago                                                                                  docklet-client
1f36b90187d9   docklet-docklet-server     "docker-entrypoint.s…"   3 minutes ago   Up 2 minutes                   127.0.0.1:3001->3001/tcp                                                       docklet-server
07a20d9f3533   edoburu/pgbouncer:latest   "/entrypoint.sh /usr…"   3 minutes ago   Up 2 minutes                   127.0.0.1:16543->5432/tcp                                                      docklet-pooler
25a9d4da19f7   postgres:15                "docker-entrypoint.s…"   3 minutes ago   Up 2 minutes (healthy)         127.0.0.1:15432->5432/tcp                                                      docklet-db
root@root:~/docklet# nano postgres.yml
root@root:~/docklet# cat postgres.yml
name: docklet

# ══════════════════════════════════════════════════════════════════
#  All credentials are read from .env in the same directory.
#  Copy .env.example → .env and fill in your values, then run:
#  docker compose -f postgres.yml up -d --build
# ══════════════════════════════════════════════════════════════════

services:

  postgres:
    container_name: docklet-db
    image: postgres:15
    restart: unless-stopped
    environment:
      POSTGRES_USER:     ${DB_USERNAME}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB:       ${DB_NAME}
    ports:
      - "127.0.0.1:15432:5432"   # local-only; haproxy proxy serves public :5432
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready"]
      interval: 10s
      timeout: 5s
      retries: 5

  pgbouncer:
    container_name: docklet-pooler
    image: edoburu/pgbouncer:latest
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "127.0.0.1:16543:5432"   # local-only; haproxy proxy serves public :6543
    environment:
      DB_HOST:     postgres
      DB_PORT:     5432
      DB_USER:     ${DB_USERNAME}
      DB_PASSWORD: ${DB_PASSWORD}
      DB_NAME:     ${DB_NAME}
      POOL_MODE:   transaction
      MAX_CLIENT_CONN:   1000
      DEFAULT_POOL_SIZE: 10
      AUTH_TYPE:   scram-sha-256
      IGNORE_STARTUP_PARAMETERS: extra_float_digits,search_path

  # ── HAProxy TCP proxy — started by "Expose Public" button ──────────────────
  # Built from Proxy/Dockerfile which bakes haproxy.cfg into the image.
  # HAProxy finds its config at the default path — no entrypoint override needed.
  docklet-proxy:
    container_name: docklet-proxy
    build:
      context: ./Proxy
    restart: unless-stopped
    ports:
      - "0.0.0.0:5432:5432"   # direct postgres (public)
      - "0.0.0.0:6543:6543"   # pgbouncer pooler (public)
    depends_on:
      postgres:
        condition: service_healthy
      pgbouncer:
        condition: service_started
    profiles:
      - expose

  docklet-server:
    container_name: docklet-server
    build:
      context: ./Backend
    restart: unless-stopped
    ports:
      - "127.0.0.1:3001:3001"
    depends_on:
      pgbouncer:
        condition: service_started
    environment:
      # ── PostgreSQL connection — connects to the pooler for best performance ──────
      PGHOST:     pgbouncer
      PGPORT:     5432
      PGUSER:     ${DB_USERNAME}
      PGPASSWORD: ${DB_PASSWORD}
      PGDATABASE: ${DB_NAME}
      # ── Docklet admin credentials ────────────────────────────────
      ADMIN_USERNAME: ${ADMIN_USERNAME}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      JWT_SECRET:     ${JWT_SECRET}
      PORT: 3001
      # ── Reverse Proxy ────────────────────────────────────────────
      SELF_CONTAINER_NAME: docklet-server
      NGINX_CONTAINER_NAME: docklet-nginx
    volumes:
      # Docker socket — required for pg_dump via docker exec
      - /var/run/docker.sock:/var/run/docker.sock
      # postgres.yml config — mounted for reference
      - ./postgres.yml:/config/postgres.yml
      # .env file — mounted so backend can read variable names if needed
      - ./.env:/config/.env
      # Proxy directory — mounted so the backend can build the proxy image
      - ./Proxy:/config/Proxy
      # Persistent backups directory
      - ./backups:/usr/src/app/backups
      # Reverse Proxy — nginx configs (written by backend, read by nginx)
      - ./nginx-configs:/usr/src/app/nginx-configs
      # Reverse Proxy — Let's Encrypt certs (written by certbot via --volumes-from)
      - ./letsencrypt:/etc/letsencrypt
      # Reverse Proxy — certbot ACME webroot challenge dir
      - ./certbot-webroot:/var/www/certbot
      # HAProxy config — backend writes this file, HAProxy reads it
      - ./docklet-proxy.cfg:/usr/src/app/docklet-proxy.cfg

  docklet-client:
    container_name: docklet-client
    build:
      context: ./Frontend
    restart: unless-stopped
    ports:
      - "0.0.0.0:3000:80"
    depends_on:
      - docklet-server

  # ── HAProxy reverse-proxy for auto-deployed app containers ─────────────────
  # No external ports — nginx reaches it directly by container name on the
  # default network. Backend writes docklet-proxy.cfg and reloads via SIGUSR2.
  docklet-haproxy:
    container_name: docklet-haproxy
    image: haproxy:alpine
    restart: unless-stopped
    volumes:
      - ./docklet-proxy.cfg:/usr/local/etc/haproxy/haproxy.cfg
    networks:
      - default
      - apps
    depends_on:
      - docklet-server

  # ── Nginx reverse proxy — domain → HAProxy container, managed by Docklet ──
  # Bridge networking so proxy_pass http://docklet-haproxy:<port> resolves via
  # Docker DNS. Ports 80/443 mapped to host for public HTTPS + ACME challenges.
  # Configs auto-written by the backend; certs at ./letsencrypt/.
  docklet-nginx:
    container_name: docklet-nginx
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx-configs:/etc/nginx/conf.d:ro
      - ./letsencrypt:/etc/letsencrypt:ro
      - ./certbot-webroot:/var/www/certbot:ro
    networks:
      - default
    depends_on:
      - docklet-server

volumes:
  pgdata:

networks:
  apps:
    name: docklet-apps
root@root:~/docklet# 