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

export async function storageCreateInstance(access_key: string, secret_key: string): Promise<{ ok: boolean }> {
  return apiFetch("/storage/instance", { method: "POST", body: JSON.stringify({ access_key, secret_key }) });
}

export async function storageDestroyInstance(): Promise<{ ok: boolean }> {
  return apiFetch("/storage/instance", { method: "DELETE" });
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
