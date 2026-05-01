import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE = "/api";

// ── Token management ──────────────────────────────────────────────────────────

export function getToken(): string | null {
  return localStorage.getItem("nextbase_token");
}

export function setToken(token: string) {
  localStorage.setItem("nextbase_token", token);
}

export function clearToken() {
  localStorage.removeItem("nextbase_token");
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers || {}) },
  });
  if (res.status === 401 && path !== "/auth/login") {
    // Read the body first — a 401 from a proxied/upstream service (e.g.
    // NVIDIA) should NOT clear the session. Only redirect to login when the
    // backend itself says the token is invalid (body has no 'message' field
    // that describes a third-party error, or explicitly carries no body).
    let body: any = {};
    try { body = await res.clone().json(); } catch { /* ignore */ }
    // If the body contains a message that is clearly about an external API
    // key, treat it as a plain error rather than a session expiry.
    const msg: string = (body?.message || "").toLowerCase();
    const isExternalApiError =
      msg.includes("api key") ||
      msg.includes("nvidia") ||
      msg.includes("invalid or expired");
    if (!isExternalApiError) {
      clearToken();
      window.location.href = "/login";
      throw new Error("Session expired. Please log in again.");
    }
    throw new Error(body?.message || "Unauthorized");
  }
  if (!res.ok) {
    let err: any;
    try { err = await res.json(); } catch { err = { message: res.statusText }; }
    throw new Error(err?.message || res.statusText);
  }
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

// Generate a short client-side terminal command id (matches backend regex
// `^c_[a-zA-Z0-9]{6,32}$`). Used so the frontend can register its socket
// listeners against a known id before the exec HTTP response arrives —
// avoiding a race where the first terminal-output events would otherwise be
// dropped by the active-id filter.
export function generateClientCommandId(): string {
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  return `c_${rand.slice(0, 14)}`;
}

export async function login(username: string, password: string): Promise<{ token: string; user: { username: string } }> {
  const data = await apiFetch<{ token: string; user: { username: string } }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setToken(data.token);
  return data;
}

export async function getMe(): Promise<{ user: { username: string } }> {
  return apiFetch("/auth/me");
}

export async function getAuthConfig(): Promise<{ username: string }> {
  return apiFetch("/auth/config");
}

// ── Health ────────────────────────────────────────────────────────────────────

export function useHealthCheck() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => apiFetch<{ status: string }>("/health"),
    refetchInterval: 30000,
    retry: false,
  });
}

// ── DB Overview ───────────────────────────────────────────────────────────────

export function useGetDbOverview() {
  return useQuery({
    queryKey: getGetDbOverviewQueryKey(),
    queryFn: () => apiFetch<{ activeConnections: number; databaseSize: string; tableCount: number }>("/db/overview"),
    refetchInterval: 10000,
  });
}

export function getGetDbOverviewQueryKey() { return ["db-overview"]; }

// ── Throughput ────────────────────────────────────────────────────────────────

export function useGetDbThroughput() {
  return useQuery({
    queryKey: getGetDbThroughputQueryKey(),
    queryFn: () => apiFetch<{ dataPoints: { timestamp: number; queries: number; inserts: number; updates: number; deletes: number }[] }>("/db/throughput"),
    refetchInterval: 5000,
  });
}

export function getGetDbThroughputQueryKey() { return ["db-throughput"]; }

// ── Activity ──────────────────────────────────────────────────────────────────

export function useGetDbActivity() {
  return useQuery({
    queryKey: getGetDbActivityQueryKey(),
    queryFn: () => apiFetch<{ activities: { pid: number; state: string; query: string; startedAt: string; duration: string }[] }>("/db/activity"),
    refetchInterval: 5000,
  });
}

export function getGetDbActivityQueryKey() { return ["db-activity"]; }

// ── Tables list ───────────────────────────────────────────────────────────────

export function useGetDbTables() {
  return useQuery({
    queryKey: getGetDbTablesQueryKey(),
    queryFn: () => apiFetch<{ tables: { tableName: string; rowCount: number; totalSize: string }[] }>("/db/tables-extended"),
    refetchInterval: 15000,
  });
}

export function getGetDbTablesQueryKey() { return ["db-tables-extended"]; }

// ── Table names only ──────────────────────────────────────────────────────────

export function useGetTableNames() {
  return useQuery({
    queryKey: ["db-table-names"],
    queryFn: () => apiFetch<{ table_name: string }[]>("/db/tables"),
  });
}

// ── Table schema ──────────────────────────────────────────────────────────────

export function useGetTableDetails(name: string | null) {
  return useQuery({
    queryKey: ["db-table", name],
    queryFn: () => apiFetch<{ columns: any[]; constraints: any[] }>(`/db/tables/${name}`),
    enabled: !!name,
  });
}

// ── Table data ────────────────────────────────────────────────────────────────

export function useGetTableData(name: string | null, params?: { limit?: number; offset?: number; sortColumn?: string; sortOrder?: string }) {
  return useQuery({
    queryKey: ["db-table-data", name, params],
    queryFn: () => {
      const q = new URLSearchParams();
      if (params?.limit) q.set("limit", String(params.limit));
      if (params?.offset) q.set("offset", String(params.offset));
      if (params?.sortColumn) q.set("sortColumn", params.sortColumn);
      if (params?.sortOrder) q.set("sortOrder", params.sortOrder);
      return apiFetch<{ data: any[]; totalCount: number; fields: any[] }>(`/db/tables/${name}/data?${q}`);
    },
    enabled: !!name,
  });
}

// ── Schema visualizer ─────────────────────────────────────────────────────────

export function useGetSchema() {
  return useQuery({
    queryKey: ["db-schema"],
    queryFn: () => apiFetch<{ tables: any[]; relations: any[] }>("/db/schema"),
  });
}

// ── DB Stats ──────────────────────────────────────────────────────────────────

export function useGetDbStats() {
  return useQuery({
    queryKey: ["db-stats"],
    queryFn: () => apiFetch<{ totalTables: number; totalRows: number; dbSize: string; dbSizeBytes: number; activeConnections: number; throughput: any[] }>("/db/stats"),
    refetchInterval: 5000,
  });
}

// ── SQL Query ─────────────────────────────────────────────────────────────────

export async function runSqlQuery(sql: string): Promise<{ rows: any[]; fields: any[]; rowCount: number; duration: number }> {
  return apiFetch("/query/run", {
    method: "POST",
    body: JSON.stringify({ sql }),
  });
}

// ── Create table ──────────────────────────────────────────────────────────────

export async function createTable(tableName: string, columns: any[]): Promise<void> {
  return apiFetch("/db/tables", {
    method: "POST",
    body: JSON.stringify({ tableName, columns }),
  });
}

// ── Drop table ────────────────────────────────────────────────────────────────

export async function dropTable(tableName: string): Promise<void> {
  return apiFetch(`/db/tables/${tableName}`, { method: "DELETE" });
}

// ── Rename table ──────────────────────────────────────────────────────────────

export async function renameTable(oldName: string, newName: string): Promise<void> {
  return apiFetch(`/db/tables/${oldName}/rename`, {
    method: "PATCH",
    body: JSON.stringify({ newName }),
  });
}

// ── Duplicate table ───────────────────────────────────────────────────────────

export async function duplicateTable(tableName: string): Promise<{ newTableName: string }> {
  return apiFetch(`/db/tables/${tableName}/duplicate`, { method: "POST" });
}

// ── Insert row ────────────────────────────────────────────────────────────────

export async function insertRow(tableName: string, row: Record<string, any>): Promise<any> {
  return apiFetch(`/db/tables/${tableName}/rows`, {
    method: "POST",
    body: JSON.stringify(row),
  });
}

// ── Update row ────────────────────────────────────────────────────────────────

export async function updateRow(tableName: string, selection: Record<string, any>, updates: Record<string, any>): Promise<any> {
  return apiFetch(`/db/tables/${tableName}/rows`, {
    method: "PATCH",
    body: JSON.stringify({ selection, updates }),
  });
}

// ── Delete row ────────────────────────────────────────────────────────────────

export async function deleteRow(tableName: string, selection: Record<string, any>): Promise<void> {
  return apiFetch(`/db/tables/${tableName}/rows`, {
    method: "DELETE",
    body: JSON.stringify(selection),
  });
}

// ── Add column ────────────────────────────────────────────────────────────────

export async function addColumn(tableName: string, columnName: string, dataType: string, defaultValue?: string, isNullable?: boolean): Promise<void> {
  return apiFetch(`/db/tables/${tableName}/columns`, {
    method: "POST",
    body: JSON.stringify({ columnName, dataType, defaultValue, isNullable }),
  });
}

// ── Drop column ───────────────────────────────────────────────────────────────

export async function dropColumn(tableName: string, columnName: string): Promise<void> {
  return apiFetch(`/db/tables/${tableName}/columns/${columnName}`, { method: "DELETE" });
}

// ── Backups ───────────────────────────────────────────────────────────────────

export type Backup = {
  id: string;
  filename: string;
  label: string;
  time: string;
  size: string;
  sizeBytes: number;
};

export function useGetBackups() {
  return useQuery({
    queryKey: ["admin-backups"],
    queryFn: () => apiFetch<Backup[]>("/admin/backups"),
    refetchInterval: 30000,
  });
}

export async function createBackup(): Promise<Backup> {
  return apiFetch("/admin/backup", { method: "POST" });
}

export function getBackupDownloadUrl(id: string): string {
  return `/api/admin/backups/${id}/download`;
}

export async function deleteBackup(id: string): Promise<void> {
  return apiFetch(`/admin/backups/${id}`, { method: "DELETE" });
}

export async function restoreSql(sql: string): Promise<{ executed: number; errors: string[] }> {
  return apiFetch("/admin/restore", {
    method: "POST",
    body: JSON.stringify({ sql }),
  });
}

// ── DB Controls ───────────────────────────────────────────────────────────────

export async function pauseDatabase(): Promise<{ paused: boolean; message: string }> {
  return apiFetch("/admin/db/pause", { method: "POST" });
}

export async function resumeDatabase(): Promise<{ paused: boolean; message: string }> {
  return apiFetch("/admin/db/resume", { method: "POST" });
}

export async function resetDatabase(): Promise<{ message: string; dropped: number }> {
  return apiFetch("/admin/db/reset", { method: "POST" });
}

// ── Connection config from postgres.yml ───────────────────────────────────────

export type ConnectionConfig = {
  user: string;
  db: string;
  containerName: string;
  poolerContainer: string;
  directPort: number;
  poolerPort: number;
  serverIp: string;
  directLocal: string;
  poolerLocal: string;
  directPublic: string;
  poolerPublic: string;
  exposed: boolean;
};

export function useGetConnectionConfig() {
  return useQuery({
    queryKey: ["admin-connection-config"],
    queryFn: () => apiFetch<ConnectionConfig>("/admin/connection"),
    refetchInterval: 5000,
  });
}

// ── Expose / Unexpose public TCP proxy ────────────────────────────────────────

export type ExposeResult = {
  exposed: boolean;
  serverIp?: string;
  directPublicPort?: number;
  poolerPublicPort?: number;
  directPublic?: string;
  poolerPublic?: string;
  mode?: 'docker' | 'docker-config-updated' | 'tcp-proxy';
  note?: string;
  dockerRunning?: boolean;
};

export async function exposeDatabase(): Promise<ExposeResult> {
  return apiFetch("/admin/expose", { method: "POST" });
}

export async function unexposeDatabase(): Promise<{ exposed: boolean }> {
  return apiFetch("/admin/unexpose", { method: "POST" });
}

// ── System (VPS) stats ────────────────────────────────────────────────────────

export type SystemStats = {
  cpu: { load: number; cores: number; model: string; speed: number };
  memory: { total: number; used: number; free: number; usedPercent: number };
  storage: { total: number; used: number; free: number; usedPercent: number; primary: any };
  load: { avgLoad: number; current: number };
  os: { platform: string; distro: string; release: string; arch: string; hostname: string; uptime: number };
  history: { timestamp: number; cpu: number; memory: number; load: number }[];
};

export function useGetSystemStats() {
  return useQuery({
    queryKey: ["system-stats"],
    queryFn: () => apiFetch<SystemStats>("/system/stats"),
    refetchInterval: 5000,
  });
}

// ── Terminal ──────────────────────────────────────────────────────────────────

export type CommandSuggestion = { cmd: string; desc: string };

export function useGetCommandSuggestions() {
  return useQuery({
    queryKey: ["terminal-suggestions"],
    queryFn: () => apiFetch<{ suggestions: CommandSuggestion[] }>("/terminal/suggestions"),
    staleTime: Infinity,
  });
}

export function useGetTerminalHistory() {
  return useQuery({
    queryKey: ["terminal-history"],
    queryFn: () => apiFetch<{ history: any[] }>("/terminal/history"),
  });
}

export async function clearTerminalHistory(): Promise<void> {
  await apiFetch("/terminal/history", { method: "DELETE" });
}

export async function checkCommandSafety(command: string): Promise<{ safe: boolean; reason?: string }> {
  return apiFetch("/terminal/safety-check", {
    method: "POST",
    body: JSON.stringify({ command }),
  });
}

export async function execCommand(command: string, confirm?: string, clientId?: string, rootMode?: boolean): Promise<{ id: string; output: string; exitCode: number; durationMs?: number; cwd?: string; requiresConfirmation?: boolean; reason?: string; message?: string }> {
  return apiFetch("/terminal/exec", {
    method: "POST",
    body: JSON.stringify({ command, confirm, clientId, rootMode }),
  });
}

export async function getTerminalCwd(): Promise<{ rootCwd: string; sandboxCwd: string }> {
  return apiFetch("/terminal/cwd");
}

export type TerminalSettings = { configured: boolean; model: string; apiKeyMasked: string | null };

export function useGetTerminalSettings() {
  return useQuery({
    queryKey: ["terminal-settings"],
    queryFn: () => apiFetch<TerminalSettings>("/terminal/settings"),
  });
}

export async function saveTerminalSettings(apiKey: string, model?: string): Promise<void> {
  return apiFetch("/terminal/settings", {
    method: "POST",
    body: JSON.stringify({ apiKey, model }),
  });
}

export async function deleteTerminalSettings(): Promise<void> {
  return apiFetch("/terminal/settings", { method: "DELETE" });
}

export async function generateAiCommand(prompt: string): Promise<{ command: string; raw: string; safe: boolean; reason: string | null; model: string }> {
  return apiFetch("/terminal/ai", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
}

// ── Docker ────────────────────────────────────────────────────────────────────

export type DockerContainer = {
  id: string;
  shortId: string;
  names: string[];
  image: string;
  command: string;
  createdAt: number;
  state: string;
  status: string;
  ports: { privatePort: number; publicPort?: number; type: string }[];
};

export type DockerStatus = { available: boolean; reason?: string; containers?: number; running?: number; stopped?: number; images?: number; serverVersion?: string; os?: string };

export function useGetDockerStatus() {
  return useQuery({
    queryKey: ["docker-status"],
    queryFn: () => apiFetch<DockerStatus>("/docker/status"),
    refetchInterval: 10000,
    retry: false,
  });
}

export function useGetDockerContainers() {
  return useQuery({
    queryKey: ["docker-containers"],
    queryFn: async () => {
      try {
        return await apiFetch<{ available: boolean; containers: DockerContainer[] }>("/docker/containers");
      } catch (err: any) {
        return { available: false, containers: [], error: err.message };
      }
    },
    refetchInterval: 5000,
    retry: false,
  });
}

export async function dockerLogs(id: string, tail = 300): Promise<{ logs: string }> {
  return apiFetch(`/docker/containers/${id}/logs?tail=${tail}`);
}

export async function dockerInspect(id: string): Promise<{ networks: Record<string, any>; mounts: any[]; hostname: string | null }> {
  return apiFetch(`/docker/containers/${id}/inspect`);
}

export async function dockerStart(id: string): Promise<void> { return apiFetch(`/docker/containers/${id}/start`, { method: "POST" }); }
export async function dockerStop(id: string): Promise<void> { return apiFetch(`/docker/containers/${id}/stop`, { method: "POST" }); }
export async function dockerRestart(id: string): Promise<void> { return apiFetch(`/docker/containers/${id}/restart`, { method: "POST" }); }
export async function dockerRemove(id: string): Promise<void> { return apiFetch(`/docker/containers/${id}`, { method: "DELETE" }); }
export async function dockerBulk(action: "start" | "stop" | "restart" | "remove"): Promise<{ ok: boolean; results: any[] }> {
  return apiFetch(`/docker/bulk/${action}`, { method: "POST" });
}

// ── GitHub Auto Deploy ────────────────────────────────────────────────────────

export type DeploySummary = {
  id: string;
  repo: string;
  name: string;
  status: "pending" | "cloning" | "building" | "running" | "failed" | "success";
  startedAt: number;
  finishedAt?: number;
  error?: string;
  hostPort?: number;
  containerPort?: number;
  containerName?: string;
};

export function useGetDeployments() {
  return useQuery({
    queryKey: ["deployments"],
    queryFn: () => apiFetch<{ deployments: DeploySummary[] }>("/deploy/list"),
    refetchInterval: 5000,
  });
}

export async function startGithubDeploy(repo: string): Promise<{ id: string; name: string }> {
  return apiFetch("/deploy/github", {
    method: "POST",
    body: JSON.stringify({ repo }),
  });
}

export async function getDeployment(id: string): Promise<any> {
  return apiFetch(`/deploy/${id}`);
}

// ── Reverse Proxy Manager ─────────────────────────────────────────────────────

export type ProxyDomain = {
  id: number;
  domain: string;
  target_port: number;
  verified: boolean;
  ssl_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export function useGetProxyDomains() {
  return useQuery({
    queryKey: ["proxy-domains"],
    queryFn: () => apiFetch<{ domains: ProxyDomain[] }>("/proxy/list"),
    refetchInterval: 8000,
  });
}

export async function getServerIp(): Promise<{ ip: string }> {
  return apiFetch("/proxy/server-ip");
}

export async function createProxyDomain(domain: string, targetPort: number): Promise<{ domain: ProxyDomain }> {
  return apiFetch("/proxy/create", {
    method: "POST",
    body: JSON.stringify({ domain, targetPort }),
  });
}

export async function verifyProxyDomain(id: number): Promise<{ verified: boolean; ip?: string; message?: string; found?: string[]; expected?: string }> {
  return apiFetch(`/proxy/verify/${id}`, { method: "POST" });
}

export async function enableProxySSL(id: number, email: string): Promise<{ started: boolean; taskId: string }> {
  return apiFetch(`/proxy/ssl/${id}`, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function deleteProxyDomain(id: number): Promise<{ ok: boolean }> {
  return apiFetch(`/proxy/${id}`, { method: "DELETE" });
}

export async function reloadProxy(): Promise<{ ok: boolean }> {
  return apiFetch("/proxy/reload", { method: "POST" });
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export type ScheduledTask = {
  id: number;
  name: string;
  cron_expr: string;
  timezone: string | null;
  script: string;
  enabled: boolean;
  created_at: number;
  updated_at: number;
};

export type TaskRun = {
  id: number;
  task_id: number;
  started_at: number;
  finished_at: number | null;
  status: "running" | "success" | "failed";
  output: string;
  exit_code: number | null;
};

export function useGetScheduledTasks() {
  return useQuery({
    queryKey: ["scheduled-tasks"],
    queryFn: () => apiFetch<{ tasks: ScheduledTask[] }>("/scheduler/tasks"),
    refetchInterval: 10000,
  });
}

export async function createScheduledTask(data: { name: string; cron_expr: string; timezone?: string; script: string; enabled?: boolean }): Promise<{ task: ScheduledTask }> {
  return apiFetch("/scheduler/tasks", { method: "POST", body: JSON.stringify(data) });
}

export async function updateScheduledTask(id: number, data: Partial<{ name: string; cron_expr: string; timezone: string; script: string; enabled: boolean }>): Promise<{ task: ScheduledTask }> {
  return apiFetch(`/scheduler/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteScheduledTask(id: number): Promise<{ ok: boolean }> {
  return apiFetch(`/scheduler/tasks/${id}`, { method: "DELETE" });
}

export async function runScheduledTask(id: number): Promise<{ runId: number }> {
  return apiFetch(`/scheduler/tasks/${id}/run`, { method: "POST" });
}

export function useGetTaskRuns(taskId: number | null) {
  return useQuery({
    queryKey: ["task-runs", taskId],
    queryFn: () => apiFetch<{ runs: TaskRun[] }>(`/scheduler/tasks/${taskId}/runs`),
    enabled: taskId !== null,
    refetchInterval: 3000,
  });
}

// ── S3 / MinIO Storage ────────────────────────────────────────────────────────

export type StorageBucket = { name: string; createdAt: string };
export type StorageFile = { key: string; size: number; lastModified: string; etag: string };
export type StorageConnection = { connected: boolean; endpoint?: string; port?: number; region?: string; use_ssl?: boolean };

export function useGetStorageConnection() {
  return useQuery({
    queryKey: ["storage-connection"],
    queryFn: () => apiFetch<StorageConnection>("/storage/connection"),
    refetchInterval: 10000,
  });
}

export function useGetStorageBuckets(enabled: boolean) {
  return useQuery({
    queryKey: ["storage-buckets"],
    queryFn: () => apiFetch<{ buckets: StorageBucket[] }>("/storage/buckets"),
    enabled,
    refetchInterval: 10000,
  });
}

export function useGetStorageFiles(bucket: string | null, prefix = "") {
  return useQuery({
    queryKey: ["storage-files", bucket, prefix],
    queryFn: () => apiFetch<{ files: StorageFile[] }>(`/storage/buckets/${bucket}/files?prefix=${encodeURIComponent(prefix)}`),
    enabled: !!bucket,
    refetchInterval: 10000,
  });
}

export async function storageConnect(payload: {
  endpoint: string; port: number; access_key: string; secret_key: string; region: string; use_ssl: boolean;
}): Promise<{ ok: boolean }> {
  return apiFetch("/storage/connect", { method: "POST", body: JSON.stringify(payload) });
}

export async function storageDisconnect(): Promise<{ ok: boolean }> {
  return apiFetch("/storage/connection", { method: "DELETE" });
}

export async function storageCreateBucket(name: string): Promise<{ ok: boolean }> {
  return apiFetch("/storage/buckets", { method: "POST", body: JSON.stringify({ name }) });
}

export async function storageDeleteBucket(name: string): Promise<{ ok: boolean }> {
  return apiFetch(`/storage/buckets/${name}`, { method: "DELETE" });
}

export async function storageDeleteFiles(bucket: string, keys: string[]): Promise<{ ok: boolean }> {
  return apiFetch(`/storage/buckets/${bucket}/files`, { method: "DELETE", body: JSON.stringify({ keys }) });
}

export async function storageRenameFile(bucket: string, oldKey: string, newKey: string): Promise<{ ok: boolean }> {
  return apiFetch(`/storage/buckets/${bucket}/files/rename`, { method: "PUT", body: JSON.stringify({ oldKey, newKey }) });
}

export async function storageDownloadUrl(bucket: string, key: string): Promise<{ url: string }> {
  return apiFetch(`/storage/buckets/${bucket}/files/download?key=${encodeURIComponent(key)}`);
}

export type StorageInstance = { exists: boolean; running: boolean; dockerAvailable: boolean; id?: string };

export function useGetStorageInstance() {
  return useQuery({
    queryKey: ["storage-instance"],
    queryFn: () => apiFetch<StorageInstance>("/storage/instance"),
    refetchInterval: 8000,
  });
}

export function useIsStorageConfigured() {
  return useQuery({
    queryKey: ["storage-configured"],
    queryFn: () => apiFetch<{ configured: boolean }>("/storage/configured"),
    staleTime: 30000,
  });
}

export async function storageCreateInstance(access_key: string, secret_key: string): Promise<{ ok: boolean; endpoint: string }> {
  return apiFetch("/storage/instance", { method: "POST", body: JSON.stringify({ access_key, secret_key }) });
}

export async function storageInstanceHealth(): Promise<{ ready: boolean; reason?: string; endpoint?: string }> {
  return apiFetch("/storage/instance/health");
}

export async function storageDestroyInstance(): Promise<{ ok: boolean }> {
  return apiFetch("/storage/instance", { method: "DELETE" });
}

// ── Domain ────────────────────────────────────────────────────────────────────
export type StorageDomain = { id: number; domain: string; verified: boolean; nginx_enabled: boolean; updated_at: string };

export function useGetStorageDomain() {
  return useQuery({
    queryKey: ["storage-domain"],
    queryFn: () => apiFetch<{ domain: StorageDomain | null; serverIP: string }>("/storage/domain"),
    staleTime: 10000,
  });
}

export async function storageAddDomain(domain: string) {
  return apiFetch<{ ok: boolean; domain: string; serverIP: string }>("/storage/domain", { method: "POST", body: JSON.stringify({ domain }) });
}

export async function storageVerifyDomain() {
  return apiFetch<{ verified: boolean; domain: string; resolved: string[]; serverIP: string; reason?: string }>("/storage/domain/verify", { method: "POST" });
}

export async function storageSetupNginx() {
  return apiFetch<{ ok: boolean; domain: string }>("/storage/domain/nginx", { method: "POST" });
}

export async function storageRemoveDomain() {
  return apiFetch<{ ok: boolean }>("/storage/domain", { method: "DELETE" });
}

// ── Bucket Policy ─────────────────────────────────────────────────────────────
export async function storageGetBucketPolicy(bucket: string) {
  return apiFetch<{ isPublic: boolean }>(`/storage/buckets/${encodeURIComponent(bucket)}/policy`);
}

export async function storageSetBucketPolicy(bucket: string, isPublic: boolean) {
  return apiFetch<{ ok: boolean; isPublic: boolean }>(`/storage/buckets/${encodeURIComponent(bucket)}/policy`, {
    method: "PUT",
    body: JSON.stringify({ public: isPublic }),
  });
}

// ── Share ─────────────────────────────────────────────────────────────────────
export async function storageShareFile(bucket: string, key: string, expiresIn: number) {
  return apiFetch<{ url: string; expiresIn: number; expiresAt: string }>(`/storage/buckets/${encodeURIComponent(bucket)}/files/share`, {
    method: "POST",
    body: JSON.stringify({ key, expiresIn }),
  });
}

export async function storageUploadFile(bucket: string, file: File, key: string, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const token = localStorage.getItem("nextbase_token");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("key", key);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/storage/buckets/${bucket}/files`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new Error(xhr.responseText)); };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(fd);
  });
}

export async function storageCreateFolder(bucket: string, folderPrefix: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const token = localStorage.getItem("nextbase_token");
    const fd = new FormData();
    const blob = new Blob([""], { type: "application/octet-stream" });
    fd.append("file", blob, ".keep");
    fd.append("key", `${folderPrefix}.keep`);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/storage/buckets/${encodeURIComponent(bucket)}/files`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new Error(xhr.responseText || "Failed to create folder")); };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(fd);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTAINER MANAGEMENT — Env Vars, Scheduler, Domain, Backup
// ═══════════════════════════════════════════════════════════════════════════════

const mgmt = (path: string, opts?: RequestInit) => apiFetch(`/mgmt${path}`, opts);
const j = (body: any) => ({ body: JSON.stringify(body) });

// ── Env Vars ──────────────────────────────────────────────────────────────────
export type ContainerEnvVar = { id: number; container_name: string; key: string; created_at: number };

export function useGetContainerEnv(name: string) {
  return useQuery({
    queryKey: ["container-env", name],
    queryFn: () => mgmt(`/containers/${encodeURIComponent(name)}/env`) as Promise<{ vars: ContainerEnvVar[] }>,
    enabled: !!name,
  });
}
export const containerEnvSet = (name: string, key: string, value: string) =>
  mgmt(`/containers/${encodeURIComponent(name)}/env`, { method: "POST", ...j({ key, value }) });
export const containerEnvDelete = (name: string, id: number) =>
  mgmt(`/containers/${encodeURIComponent(name)}/env/${id}`, { method: "DELETE" });
export const containerEnvApply = (name: string) =>
  mgmt(`/containers/${encodeURIComponent(name)}/env/apply`, { method: "POST" });

// ── Container Scheduler ───────────────────────────────────────────────────────
export type ContainerSchedule = {
  id: number; container_name: string; label: string; cron_expr: string;
  command: string; enabled: boolean; last_run: number | null; created_at: number;
};
export type ContainerScheduleLog = {
  id: number; schedule_id: number; started_at: number; finished_at: number | null;
  status: string; output: string;
};

export function useGetContainerSchedules(name: string) {
  return useQuery({
    queryKey: ["container-schedules", name],
    queryFn: () => mgmt(`/containers/${encodeURIComponent(name)}/schedules`) as Promise<{ schedules: ContainerSchedule[] }>,
    enabled: !!name,
  });
}
export const containerScheduleCreate = (name: string, data: Partial<ContainerSchedule>) =>
  mgmt(`/containers/${encodeURIComponent(name)}/schedules`, { method: "POST", ...j(data) });
export const containerScheduleUpdate = (name: string, id: number, data: Partial<ContainerSchedule>) =>
  mgmt(`/containers/${encodeURIComponent(name)}/schedules/${id}`, { method: "PATCH", ...j(data) });
export const containerScheduleDelete = (name: string, id: number) =>
  mgmt(`/containers/${encodeURIComponent(name)}/schedules/${id}`, { method: "DELETE" });
export const containerScheduleRun = (name: string, id: number) =>
  mgmt(`/containers/${encodeURIComponent(name)}/schedules/${id}/run`, { method: "POST" });
export const containerScheduleLogs = (name: string, id: number) =>
  mgmt(`/containers/${encodeURIComponent(name)}/schedules/${id}/logs`) as Promise<{ logs: ContainerScheduleLog[] }>;

// ── Base Domain ───────────────────────────────────────────────────────────────
export type BaseDomainConfig = { id: number; domain: string; verified: boolean; vps_ip: string; created_at: number };

export function useGetBaseDomain() {
  return useQuery({
    queryKey: ["base-domain"],
    queryFn: () => mgmt('/base-domain') as Promise<{ config: BaseDomainConfig | null }>,
    staleTime: 30000,
  });
}
export const baseDomainSave = (domain: string, vps_ip: string) =>
  mgmt('/base-domain', { method: "POST", ...j({ domain, vps_ip }) });
export const baseDomainVerify = () =>
  mgmt('/base-domain/verify', { method: "POST" }) as Promise<{ verified: boolean; apexOk: boolean; wildcardOk: boolean; apexIps: string[]; wildcardIps: string[]; vps_ip: string }>;

// ── Container Domain ──────────────────────────────────────────────────────────
export type ContainerDomain = {
  id: number; container_name: string; subdomain: string; full_domain: string;
  port: number; nginx_enabled: boolean; created_at: number;
};

export const containerDomainGet = (name: string) =>
  mgmt(`/containers/${encodeURIComponent(name)}/domain`) as Promise<{ domain: ContainerDomain | null; baseDomain: BaseDomainConfig | null }>;
export const containerDomainAssign = (name: string, port: number, subdomain?: string) =>
  mgmt(`/containers/${encodeURIComponent(name)}/domain`, { method: "POST", ...j({ port, subdomain }) });
export const containerDomainNginx = (name: string) =>
  mgmt(`/containers/${encodeURIComponent(name)}/domain/nginx`, { method: "POST" });
export const containerDomainDelete = (name: string) =>
  mgmt(`/containers/${encodeURIComponent(name)}/domain`, { method: "DELETE" });
export const containerDomainRegenerate = (name: string) =>
  mgmt(`/containers/${encodeURIComponent(name)}/domain/regenerate`, { method: "POST" });

// ── Backups ───────────────────────────────────────────────────────────────────
export type ContainerBackup = {
  id: number; container_name: string; label: string; cron_expr: string | null;
  s3_bucket: string; prefix: string; keep_n: number; enabled: boolean; created_at: number;
};
export type ContainerBackupLog = {
  id: number; backup_id: number; started_at: number; finished_at: number | null;
  status: string; output: string; s3_key: string | null;
};
export type S3BackupFile = { key: string; size: number; lastModified: string };

export function useGetContainerBackups(name: string) {
  return useQuery({
    queryKey: ["container-backups", name],
    queryFn: () => mgmt(`/containers/${encodeURIComponent(name)}/backups`) as Promise<{ backups: ContainerBackup[] }>,
    enabled: !!name,
  });
}
export const containerBackupCreate = (name: string, data: Partial<ContainerBackup>) =>
  mgmt(`/containers/${encodeURIComponent(name)}/backups`, { method: "POST", ...j(data) });
export const containerBackupUpdate = (name: string, id: number, data: Partial<ContainerBackup>) =>
  mgmt(`/containers/${encodeURIComponent(name)}/backups/${id}`, { method: "PATCH", ...j(data) });
export const containerBackupDelete = (name: string, id: number) =>
  mgmt(`/containers/${encodeURIComponent(name)}/backups/${id}`, { method: "DELETE" });
export const containerBackupRun = (name: string, id: number) =>
  mgmt(`/containers/${encodeURIComponent(name)}/backups/${id}/run`, { method: "POST" });
export const containerBackupLogs = (name: string, id: number) =>
  mgmt(`/containers/${encodeURIComponent(name)}/backups/${id}/logs`) as Promise<{ logs: ContainerBackupLog[] }>;
export const containerBackupS3Files = (name: string, id: number) =>
  mgmt(`/containers/${encodeURIComponent(name)}/backups/${id}/s3-files`) as Promise<{ files: S3BackupFile[] }>;
export const containerRestore = (name: string, s3_bucket: string, s3_key: string) =>
  mgmt(`/containers/${encodeURIComponent(name)}/restore`, { method: "POST", ...j({ s3_bucket, s3_key }) });
export const getContainerDbType = (name: string) =>
  mgmt(`/containers/${encodeURIComponent(name)}/db-type`) as Promise<{ dbType: "postgres" | "mysql" | "mariadb" | "mongo" | null }>;

// ── Container Stats ────────────────────────────────────────────────────────────
export type ContainerStats = {
  cpuPercent: number; memUsage: number; memLimit: number; memPercent: number;
  uptimeMs: number; netRx: number; netTx: number;
};
export const getContainerStats = (id: string) =>
  apiFetch(`/docker/containers/${encodeURIComponent(id)}/stats`) as Promise<ContainerStats>;

// ── Env Versioning ─────────────────────────────────────────────────────────────
export type EnvVersion = { id: number; version: number; applied_at: number };
export const containerEnvVersions = (name: string) =>
  mgmt(`/containers/${encodeURIComponent(name)}/env/versions`) as Promise<{ versions: EnvVersion[] }>;
export const containerEnvRollback = (name: string, version: number) =>
  mgmt(`/containers/${encodeURIComponent(name)}/env/rollback/${version}`, { method: "POST" });

// ── Traefik ────────────────────────────────────────────────────────────────────
export const containerDomainTraefik = (name: string) =>
  mgmt(`/containers/${encodeURIComponent(name)}/domain/traefik`, { method: "POST" });
export const traefikComposeSnippet = (email?: string) =>
  mgmt(`/traefik/compose-snippet${email ? `?email=${encodeURIComponent(email)}` : ''}`) as Promise<{ snippet: string; domain: string; email: string }>;

// ── Extended ContainerDomain type ──────────────────────────────────────────────
export type ContainerDomainV2 = ContainerDomain & { traefik_enabled: boolean; routing_mode: string };

// ── Extended ContainerSchedule type ───────────────────────────────────────────
export type ContainerScheduleV2 = ContainerSchedule & {
  is_running: boolean; timeout_secs: number; max_retries: number;
};
export type ContainerScheduleLogV2 = ContainerScheduleLog & { retry_count: number };

// ── Verified Domains ───────────────────────────────────────────────────────────
export type VerifiedDomain = {
  id: number;
  domain: string;
  vps_ip: string;
  verified: boolean;
  created_at: number;
};

export function useGetVerifiedDomains() {
  return useQuery({
    queryKey: ["verified-domains"],
    queryFn: () => apiFetch<{ domains: VerifiedDomain[]; serverIp: string }>("/domains"),
    staleTime: 30_000,
  });
}

export const addVerifiedDomain = (domain: string, vps_ip: string) =>
  apiFetch<{ domain: VerifiedDomain }>("/domains", { method: "POST", ...j({ domain, vps_ip }) });

export const deleteVerifiedDomain = (id: number) =>
  apiFetch<{ ok: boolean }>(`/domains/${id}`, { method: "DELETE" });

export const verifyVerifiedDomain = (id: number) =>
  apiFetch<{ verified: boolean; apexOk: boolean; wildcardOk: boolean; apexIps: string[]; wildcardIps: string[]; vps_ip: string }>(`/domains/${id}/verify`, { method: "POST" });

export const getDomainsServerIp = () =>
  apiFetch<{ ip: string }>("/domains/server-ip");
