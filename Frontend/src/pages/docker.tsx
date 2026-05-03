import React, { useState, useRef, useEffect } from "react";
import { Sun, Moon, Container, Play, Square, RotateCw, Trash2, RefreshCw, AlertTriangle, Loader2, Cpu, MemoryStick, Package, Code2, Database, ChevronDown, ChevronRight, X, CheckCircle2, Terminal, Plus, Eye, EyeOff } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { useLocation } from "wouter";
import {
  useGetDockerStatus, useGetDockerContainers,
  dockerStart, dockerStop, dockerRestart, dockerRemove, dockerBulk,
  dockerPullRun, dockerComposeUp,
  getContainerStats,
  type DockerContainer, type ContainerStats,
} from "@/api/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

// ── Stats helpers ─────────────────────────────────────────────────────────────
function fmtBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)}M`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`;
}

function fmtUptime(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function ContainerStatsRow({ id, running }: { id: string; running: boolean }) {
  const [stats, setStats] = useState<ContainerStats | null>(null);
  const [errCount, setErrCount] = useState(0);

  useEffect(() => {
    if (!running) { setStats(null); setErrCount(0); return; }
    let cancelled = false;
    let errorStreak = 0;
    let timerId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelled) return;
      try {
        const s = await getContainerStats(id);
        if (cancelled) return;
        setStats(s);
        if (!(s as any).error) { errorStreak = 0; setErrCount(0); }
        timerId = setTimeout(poll, 6000);
      } catch {
        if (cancelled) return;
        errorStreak++;
        setErrCount(errorStreak);
        const delay = Math.min(10000 * Math.pow(2, errorStreak - 1), 60000);
        if (errorStreak < 6) timerId = setTimeout(poll, delay);
      }
    };

    poll();
    return () => { cancelled = true; clearTimeout(timerId); };
  }, [id, running]);

  if (!running) return <span className="text-muted-foreground text-[10px]">—</span>;
  if (errCount >= 6) return <span className="text-muted-foreground text-[10px]">n/a</span>;
  if (!stats) return <span className="text-muted-foreground text-[10px] animate-pulse">…</span>;

  const cpuColor = stats.cpuPercent > 80 ? "text-red-400" : stats.cpuPercent > 40 ? "text-amber-400" : "text-emerald-400";
  const memColor = stats.memPercent > 85 ? "text-red-400" : stats.memPercent > 60 ? "text-amber-400" : "text-muted-foreground";

  return (
    <div className="flex items-center gap-3 text-[10px] font-mono">
      <div className="flex items-center gap-1">
        <Cpu className="w-2.5 h-2.5 text-muted-foreground" />
        <span className={cpuColor}>{stats.cpuPercent.toFixed(1)}%</span>
      </div>
      <div className="flex items-center gap-1">
        <MemoryStick className="w-2.5 h-2.5 text-muted-foreground" />
        <span className={memColor}>{fmtBytes(stats.memUsage)}</span>
      </div>
      {stats.uptimeMs > 0 && <span className="text-muted-foreground">↑{fmtUptime(stats.uptimeMs)}</span>}
    </div>
  );
}

function DockerLogo({ className }: { className?: string }) {
  return <img src="/docker-icon.png" alt="Docker" className={className} />;
}

// ── Container Card ────────────────────────────────────────────────────────────
function ContainerCard({
  container, busy, onAction, onClick,
}: {
  container: DockerContainer; busy: string | null;
  onAction: (id: string, fn: (id: string) => Promise<void>, label: string, e: React.MouseEvent) => void;
  onClick: () => void;
}) {
  const running = container.state === "running";
  const name = (container.names[0] || container.shortId).replace(/^\//, "");

  return (
    <div
      className="group relative bg-card border border-border rounded-2xl overflow-hidden cursor-pointer hover:border-primary/40 hover:shadow-md transition-all duration-200"
      onClick={onClick}
    >
      <div className="p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className={`p-2.5 rounded-xl border shrink-0 ${running ? "bg-[#2496ed]/10 border-[#2496ed]/20" : "bg-muted/60 border-border"}`}>
            <DockerLogo className={`w-6 h-5 ${running ? "text-[#2496ed]" : "text-muted-foreground"}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-foreground leading-tight truncate">{name}</p>
            <p className="font-mono text-[10px] text-muted-foreground truncate mt-0.5">{container.image}</p>
          </div>
          <Badge
            variant="outline"
            className={`text-[10px] font-mono uppercase rounded-full px-2 py-0 shrink-0 ${
              running ? "text-primary bg-primary/10 border-primary/20" : "text-muted-foreground bg-muted/50 border-border"
            }`}
          >
            {container.state}
          </Badge>
        </div>

        <div className="flex items-center justify-between mb-4">
          <ContainerStatsRow id={container.id} running={running} />
          <span className="text-[10px] text-muted-foreground font-mono">{container.shortId}</span>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <span className="text-[10px] text-muted-foreground">
            Created {format(new Date(container.createdAt), "MMM dd, yyyy")}
          </span>
          {container.ports && container.ports.length > 0 && (
            <>
              <span className="text-muted-foreground/40 text-[10px]">·</span>
              <span className="text-[10px] font-mono text-muted-foreground truncate">
                {container.ports.slice(0, 2).map((p: any) => p.PublicPort ? `${p.PublicPort}:${p.PrivatePort}` : `${p.PrivatePort}`).join(", ")}
                {container.ports.length > 2 && ` +${container.ports.length - 2}`}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 pt-3 border-t border-border/60" onClick={e => e.stopPropagation()}>
          {busy === container.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground mr-1 shrink-0" />}
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10" disabled={running || busy === container.id} title="Start" onClick={e => onAction(container.id, dockerStart, "Start", e)}>
            <Play className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10" disabled={!running || busy === container.id} title="Stop" onClick={e => onAction(container.id, dockerStop, "Stop", e)}>
            <Square className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10" disabled={busy === container.id} title="Restart" onClick={e => onAction(container.id, dockerRestart, "Restart", e)}>
            <RotateCw className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10" disabled={busy === container.id} title="Remove" onClick={e => onAction(container.id, dockerRemove, "Remove", e)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
          <div className="flex-1" />
          <span className="text-[10px] text-muted-foreground group-hover:text-primary transition-colors">Open →</span>
        </div>
      </div>
    </div>
  );
}

// ── Stat summary card ─────────────────────────────────────────────────────────
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="bg-background border-border shadow-none rounded-xl">
      <CardContent className="p-5">
        <p className="text-xs font-medium text-muted-foreground tracking-wide mb-2">{label}</p>
        <p className="text-2xl font-normal tracking-tight text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

// ── Database catalog ──────────────────────────────────────────────────────────
type DbField = { key: string; label: string; default: string; password?: boolean; cmdArg?: boolean };
type DbDef = {
  id: string; name: string; version: string; image: string;
  logoUrl?: string; defaultPort: string; extraPorts?: string[];
  hasAdminPanel?: boolean;
  fields: DbField[];
};

const CDN = "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons";

const DB_CATALOG: DbDef[] = [
  { id: "postgres", name: "PostgreSQL", version: "16", image: "postgres:16", logoUrl: `${CDN}/postgresql/postgresql-original.svg`, hasAdminPanel: true, defaultPort: "5432", fields: [
    { key: "POSTGRES_DB", label: "Database", default: "mydb" },
    { key: "POSTGRES_USER", label: "Username", default: "postgres" },
    { key: "POSTGRES_PASSWORD", label: "Password", default: "postgres", password: true },
  ]},
  { id: "mysql", name: "MySQL", version: "8", image: "mysql:8", logoUrl: `${CDN}/mysql/mysql-original.svg`, hasAdminPanel: true, defaultPort: "3306", fields: [
    { key: "MYSQL_DATABASE", label: "Database", default: "mydb" },
    { key: "MYSQL_ROOT_PASSWORD", label: "Root password", default: "rootpass", password: true },
    { key: "MYSQL_USER", label: "User", default: "myuser" },
    { key: "MYSQL_PASSWORD", label: "User password", default: "mypass", password: true },
  ]},
  { id: "mariadb", name: "MariaDB", version: "11", image: "mariadb:11", logoUrl: `${CDN}/mariadb/mariadb-original.svg`, hasAdminPanel: true, defaultPort: "3306", fields: [
    { key: "MARIADB_DATABASE", label: "Database", default: "mydb" },
    { key: "MARIADB_USER", label: "User", default: "myuser" },
    { key: "MARIADB_PASSWORD", label: "User password", default: "mypass", password: true },
    { key: "MARIADB_ROOT_PASSWORD", label: "Root password", default: "rootpass", password: true },
  ]},
  { id: "mongodb", name: "MongoDB", version: "7", image: "mongo:7", logoUrl: `${CDN}/mongodb/mongodb-original.svg`, defaultPort: "27017", fields: [
    { key: "MONGO_INITDB_DATABASE", label: "Database", default: "mydb" },
    { key: "MONGO_INITDB_ROOT_USERNAME", label: "Username", default: "admin" },
    { key: "MONGO_INITDB_ROOT_PASSWORD", label: "Password", default: "secret", password: true },
  ]},
  { id: "redis", name: "Redis", version: "7", image: "redis:7-alpine", logoUrl: `${CDN}/redis/redis-original.svg`, defaultPort: "6379", fields: [
    { key: "__redis_pass__", label: "Password (optional)", default: "", password: true, cmdArg: true },
  ]},
  { id: "rabbitmq", name: "RabbitMQ", version: "3-mgmt", image: "rabbitmq:3-management", logoUrl: `${CDN}/rabbitmq/rabbitmq-original.svg`, defaultPort: "5672", extraPorts: ["15672:15672"], fields: [
    { key: "RABBITMQ_DEFAULT_USER", label: "Username", default: "admin" },
    { key: "RABBITMQ_DEFAULT_PASS", label: "Password", default: "admin", password: true },
  ]},
  { id: "memcached", name: "Memcached", version: "1", image: "memcached:1-alpine", defaultPort: "11211", fields: [] },
];

// ── Log stream modal ──────────────────────────────────────────────────────────
function LogModal({ open, onClose, logs, done, ok, title }: {
  open: boolean; onClose: () => void;
  logs: string[]; done: boolean; ok: boolean; title: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  return (
    <Dialog open={open} onOpenChange={o => { if (!o && done) onClose(); }}>
      <DialogContent className="max-w-2xl w-full p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b border-border flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-muted-foreground" />
            <DialogTitle className="text-sm font-medium">{title}</DialogTitle>
          </div>
          <div className="flex items-center gap-2">
            {!done && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Running…</span>}
            {done && ok && <span className="flex items-center gap-1.5 text-xs text-emerald-500"><CheckCircle2 className="w-3.5 h-3.5" />Done</span>}
            {done && !ok && <span className="flex items-center gap-1.5 text-xs text-destructive"><X className="w-3.5 h-3.5" />Failed</span>}
            <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground" disabled={!done} onClick={onClose}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </DialogHeader>
        <div className="bg-black/90 font-mono text-[11px] text-green-400 p-4 h-80 overflow-y-auto leading-relaxed">
          {logs.map((l, i) => <span key={i} className="whitespace-pre-wrap break-all">{l}</span>)}
          {!done && <span className="animate-pulse">▌</span>}
          <div ref={bottomRef} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function DockerPage() {
  const { theme, toggle } = useTheme();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { data: status } = useGetDockerStatus();
  const { data: containersData, isLoading } = useGetDockerContainers();
  const [bulkAction, setBulkAction] = useState<"start" | "stop" | "restart" | "remove" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Docker Hub installer
  const [hubImage, setHubImage] = useState("");
  const [hubName, setHubName] = useState("");
  const [hubPort, setHubPort] = useState("");

  // Compose installer
  const [showCompose, setShowCompose] = useState(false);
  const [composeYaml, setComposeYaml] = useState("");

  // DB spinner
  const [selectedDb, setSelectedDb] = useState<DbDef | null>(null);
  const [dbValues, setDbValues] = useState<Record<string, string>>({});
  const [dbContainerName, setDbContainerName] = useState("");
  const [dbPort, setDbPort] = useState("");
  const [dbPublic, setDbPublic] = useState(false);
  const [dbIncludeAdminer, setDbIncludeAdminer] = useState(false);
  const [dbAdminerPort, setDbAdminerPort] = useState("8080");
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  // Shared log modal
  const [logTitle, setLogTitle] = useState("");
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logDone, setLogDone] = useState(false);
  const [logOk, setLogOk] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["docker-containers"] });
    qc.invalidateQueries({ queryKey: ["docker-status"] });
  }, [qc]);

  async function action(id: string, fn: (id: string) => Promise<void>, label: string, e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(id);
    try { await fn(id); toast.success(`${label} succeeded`); refresh(); }
    catch (err: any) { toast.error(err.message || `${label} failed`); }
    finally { setBusy(null); }
  }

  async function runBulk() {
    if (!bulkAction) return;
    try {
      const r = await dockerBulk(bulkAction);
      const failed = r.results.filter(x => !x.ok).length;
      if (failed) toast.warning(`${bulkAction} completed with ${failed} failure(s)`);
      else toast.success(`Bulk ${bulkAction} succeeded`);
      refresh();
    } catch (err: any) { toast.error(err.message || "Bulk action failed"); }
    finally { setBulkAction(null); }
  }

  function openLog(title: string) {
    setLogTitle(title);
    setLogLines([]);
    setLogDone(false);
    setLogOk(false);
    setShowLog(true);
  }

  async function deployHub() {
    if (!hubImage.trim()) { toast.error("Enter an image name"); return; }
    const ports = hubPort.trim() ? [hubPort.trim()] : [];
    openLog(`Deploying ${hubImage}`);
    const result = await dockerPullRun(hubImage.trim(), hubName.trim(), ports, [], [], line => {
      setLogLines(p => [...p, line]);
    });
    setLogOk(result.ok);
    setLogDone(true);
    if (result.ok) { toast.success("Container deployed!"); refresh(); setHubImage(""); setHubName(""); setHubPort(""); }
    else toast.error(result.error || "Deploy failed");
  }

  async function deployCompose() {
    if (!composeYaml.trim()) { toast.error("Paste a compose file first"); return; }
    setShowCompose(false);
    openLog("Compose Deploy");
    const result = await dockerComposeUp(composeYaml.trim(), line => {
      setLogLines(p => [...p, line]);
    });
    setLogOk(result.ok);
    setLogDone(true);
    if (result.ok) { toast.success("Compose deployed!"); refresh(); setComposeYaml(""); }
    else toast.error(result.error || "Deploy failed");
  }

  function openDbModal(db: DbDef) {
    const defaults: Record<string, string> = {};
    db.fields.forEach(f => { defaults[f.key] = f.default; });
    setDbValues(defaults);
    setDbContainerName(db.id);
    setDbPort(db.defaultPort);
    setDbPublic(false);
    setDbIncludeAdminer(false);
    setDbAdminerPort("8080");
    setShowPasswords({});
    setSelectedDb(db);
  }

  async function deployDb() {
    if (!selectedDb) return;
    const env: string[] = [];
    let cmd: string[] = [];
    for (const f of selectedDb.fields) {
      const val = dbValues[f.key] || "";
      if (f.cmdArg) {
        if (val) {
          if (selectedDb.id === "redis" || selectedDb.id === "valkey") {
            cmd = ["redis-server", "--requirepass", val];
          }
        }
      } else if (val) {
        env.push(`${f.key}=${val}`);
      }
    }
    const hostIp = dbPublic ? "0.0.0.0" : "127.0.0.1";
    const ports: string[] = [`${hostIp}:${dbPort}:${selectedDb.defaultPort}`];
    if (selectedDb.extraPorts) ports.push(...selectedDb.extraPorts.map(p => `${hostIp}:${p}`));

    const dbCopy = selectedDb;
    const includeAdminer = dbIncludeAdminer && !!dbCopy.hasAdminPanel;
    const adminerPort = dbAdminerPort;
    const adminerName = `${dbContainerName}-adminer`;
    setSelectedDb(null);
    openLog(`Spinning up ${dbCopy.name}${includeAdminer ? " + Adminer" : ""}`);
    const result = await dockerPullRun(dbCopy.image, dbContainerName, ports, env, cmd, line => {
      setLogLines(p => [...p, line]);
    });
    if (result.ok && includeAdminer) {
      setLogLines(p => [...p, `\n— Deploying Adminer on port ${adminerPort}...\n`]);
      const adminerResult = await dockerPullRun(
        "adminer:latest", adminerName,
        [`${hostIp}:${adminerPort}:8080`],
        [`ADMINER_DEFAULT_SERVER=${dbContainerName}`],
        [],
        line => setLogLines(p => [...p, line])
      );
      setLogOk(adminerResult.ok);
      setLogDone(true);
      if (adminerResult.ok) { toast.success(`${dbCopy.name} + Adminer started!`); refresh(); }
      else toast.error(adminerResult.error || "Adminer deploy failed");
    } else {
      setLogOk(result.ok);
      setLogDone(true);
      if (result.ok) { toast.success(`${dbCopy.name} started!`); refresh(); }
      else toast.error(result.error || "Deploy failed");
    }
  }

  const containers = containersData?.containers || [];
  const dockerOk = status?.available !== false;

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <DesktopSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="px-4 h-18 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MobileSidebarTrigger />
              <div className="hidden lg:flex items-center gap-3">
                <div className="p-1.5 rounded-lg bg-[#2496ed]/10 border border-[#2496ed]/20 shrink-0">
                  <DockerLogo className="w-5 h-4 text-[#2496ed]" />
                </div>
                <span className="font-medium text-sm tracking-tight">Docker Manager</span>
                {status?.available && (
                  <Badge variant="outline" className="font-mono text-[10px] uppercase rounded-full px-2 py-0 text-primary bg-primary/10 border-primary/20">
                    {status.serverVersion}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground" onClick={toggle}>
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
              <Button variant="outline" size="sm" className="h-8 rounded-full text-xs" onClick={refresh}>
                <RefreshCw className="w-3.5 h-3.5 mr-2" />Refresh
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-8 space-y-6 pb-24 max-w-6xl w-full mx-auto">
          <div className="flex flex-col gap-2 mb-4">
            <h1 className="text-4xl sm:text-5xl font-normal tracking-tight text-foreground leading-none">Docker Manager</h1>
            <p className="text-muted-foreground text-sm max-w-xl leading-relaxed">
              Manage containers running on the host. Click a card to open its detail page.
            </p>
          </div>

          {!dockerOk && (
            <Card className="bg-amber-500/10 border-amber-500/30 shadow-none rounded-xl">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground text-sm mb-1">Docker is not available</p>
                  <p className="text-xs text-muted-foreground">{status?.reason || "The Docker socket is not reachable."}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {dockerOk && status && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total Containers" value={String(status.containers ?? 0)} />
              <StatCard label="Running" value={String(status.running ?? 0)} />
              <StatCard label="Stopped" value={String(status.stopped ?? 0)} />
              <StatCard label="Images" value={String(status.images ?? 0)} />
            </div>
          )}

          {/* ── Quick Deploy ─────────────────────────────────────────────── */}
          <div>
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Quick Deploy</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Docker Hub installer */}
              <Card className="bg-background border-border shadow-none rounded-xl">
                <CardHeader className="p-4 pb-3 border-b border-border/50">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-[#2496ed]/10 border border-[#2496ed]/20">
                      <Package className="w-3.5 h-3.5 text-[#2496ed]" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-medium">Docker Hub</CardTitle>
                      <CardDescription className="text-xs text-muted-foreground">Pull any image and run it instantly</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Image</Label>
                    <Input
                      placeholder="nginx:latest, redis:7, node:20-alpine…"
                      value={hubImage}
                      onChange={e => setHubImage(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && deployHub()}
                      className="h-8 text-xs font-mono"
                      disabled={!dockerOk}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Container name (optional)</Label>
                      <Input placeholder="my-app" value={hubName} onChange={e => setHubName(e.target.value)} className="h-8 text-xs" disabled={!dockerOk} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Port (optional)</Label>
                      <Input placeholder="80:80" value={hubPort} onChange={e => setHubPort(e.target.value)} className="h-8 text-xs font-mono" disabled={!dockerOk} />
                    </div>
                  </div>
                  <Button
                    className="w-full h-8 text-xs bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none"
                    disabled={!dockerOk || !hubImage.trim()}
                    onClick={deployHub}
                  >
                    <Play className="w-3 h-3 mr-1.5" />Deploy
                  </Button>
                </CardContent>
              </Card>

              {/* Compose installer */}
              <Card className="bg-background border-border shadow-none rounded-xl">
                <CardHeader className="p-4 pb-3 border-b border-border/50">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20">
                      <Code2 className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-medium">Compose Deploy</CardTitle>
                      <CardDescription className="text-xs text-muted-foreground">Paste a docker-compose.yml and deploy</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 flex flex-col gap-3 justify-between h-[calc(100%-72px)]">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Paste your <code className="font-mono text-foreground bg-muted/50 px-1 rounded">docker-compose.yml</code> content and watch it deploy with real-time logs.
                  </p>
                  <Button
                    variant="outline"
                    className="w-full h-8 text-xs"
                    disabled={!dockerOk}
                    onClick={() => setShowCompose(true)}
                  >
                    <Code2 className="w-3 h-3 mr-1.5" />Open Compose Editor
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* ── Spin a Database ──────────────────────────────────────────── */}
          <div>
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Spin a Database</h2>
            <div className="flex flex-wrap justify-center gap-2">
              {DB_CATALOG.map(db => (
                <button
                  key={db.id}
                  onClick={() => dockerOk && openDbModal(db)}
                  disabled={!dockerOk}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 hover:border-primary/30 transition-all text-center group disabled:opacity-40 disabled:cursor-not-allowed w-24"
                >
                  {db.logoUrl
                    ? <img src={db.logoUrl} alt={db.name} className="w-8 h-8 object-contain" />
                    : <Database className="w-8 h-8 text-muted-foreground" />}
                  <div>
                    <p className="text-xs font-medium text-foreground leading-tight">{db.name}</p>
                    <p className="text-[10px] text-muted-foreground">{db.version}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ── Bulk Actions ─────────────────────────────────────────────── */}
          <Card className="bg-background border-border shadow-none rounded-xl">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium tracking-tight">Bulk Actions</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">Apply an action to all containers at once.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-2 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={!dockerOk} onClick={() => setBulkAction("start")}><Play className="w-3.5 h-3.5 mr-1.5" />Start All</Button>
              <Button variant="outline" size="sm" disabled={!dockerOk} onClick={() => setBulkAction("stop")}><Square className="w-3.5 h-3.5 mr-1.5" />Stop All</Button>
              <Button variant="outline" size="sm" disabled={!dockerOk} onClick={() => setBulkAction("restart")}><RotateCw className="w-3.5 h-3.5 mr-1.5" />Restart All</Button>
              <Button variant="destructive" size="sm" disabled={!dockerOk} onClick={() => setBulkAction("remove")}><Trash2 className="w-3.5 h-3.5 mr-1.5" />Remove All</Button>
            </CardContent>
          </Card>

          {/* ── Container Cards ───────────────────────────────────────────── */}
          <div>
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Containers {!isLoading && `(${containers.length})`}
            </h2>
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-2xl border border-border p-5 space-y-4">
                    <div className="flex items-start gap-3">
                      <Skeleton className="w-10 h-10 rounded-xl bg-muted" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-3/4 bg-muted" />
                        <Skeleton className="h-3 w-full bg-muted" />
                      </div>
                    </div>
                    <Skeleton className="h-3 w-1/2 bg-muted" />
                    <Skeleton className="h-8 w-full bg-muted rounded-lg" />
                  </div>
                ))}
              </div>
            ) : containers.length === 0 ? (
              <div className="rounded-2xl border border-border border-dashed p-12 text-center">
                <DockerLogo className="w-10 h-8 text-muted-foreground/40 mx-auto mb-4" />
                <p className="text-sm text-muted-foreground">{dockerOk ? "No containers found" : "Docker is not available."}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {containers.map(c => (
                  <ContainerCard
                    key={c.id}
                    container={c}
                    busy={busy}
                    onAction={action}
                    onClick={() => navigate(`/docker/${c.id}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ── Bulk confirm dialog ───────────────────────────────────────────── */}
      <AlertDialog open={!!bulkAction} onOpenChange={o => { if (!o) setBulkAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm bulk {bulkAction}</AlertDialogTitle>
            <AlertDialogDescription>This will {bulkAction} <span className="font-semibold">all</span> containers on the host. Continue?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runBulk}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Compose editor modal ──────────────────────────────────────────── */}
      <Dialog open={showCompose} onOpenChange={setShowCompose}>
        <DialogContent className="max-w-2xl w-full">
          <DialogHeader>
            <DialogTitle className="text-sm font-medium flex items-center gap-2">
              <Code2 className="w-4 h-4" />Compose Deploy
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Paste your <code className="font-mono bg-muted/50 px-1 rounded">docker-compose.yml</code> content below.</p>
            <Textarea
              value={composeYaml}
              onChange={e => setComposeYaml(e.target.value)}
              placeholder={"version: '3.8'\nservices:\n  app:\n    image: nginx:latest\n    ports:\n      - '80:80'"}
              className="font-mono text-xs h-64 resize-none"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowCompose(false)}>Cancel</Button>
              <Button
                size="sm"
                className="text-xs bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none"
                disabled={!composeYaml.trim()}
                onClick={deployCompose}
              >
                <Play className="w-3 h-3 mr-1.5" />Deploy
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── DB config modal ───────────────────────────────────────────────── */}
      <Dialog open={!!selectedDb} onOpenChange={o => { if (!o) setSelectedDb(null); }}>
        <DialogContent className="max-w-md w-full">
          {selectedDb && (
            <>
              <DialogHeader>
                <DialogTitle className="text-sm font-medium flex items-center gap-2">
                  {selectedDb.logoUrl
                    ? <img src={selectedDb.logoUrl} alt={selectedDb.name} className="w-6 h-6 object-contain" />
                    : <Database className="w-5 h-5 text-muted-foreground" />}
                  Spin up {selectedDb.name}
                  <Badge variant="outline" className="text-[10px] font-mono ml-1">{selectedDb.image}</Badge>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Container name</Label>
                    <Input value={dbContainerName} onChange={e => setDbContainerName(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Host port</Label>
                    <Input value={dbPort} onChange={e => setDbPort(e.target.value)} className="h-8 text-xs font-mono" />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <div>
                    <p className="text-xs font-medium">{dbPublic ? "Public" : "Private"}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {dbPublic ? "Bound to 0.0.0.0 — accessible from outside the host" : "Bound to 127.0.0.1 — localhost only"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDbPublic(p => !p)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${dbPublic ? "bg-primary" : "bg-muted"}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${dbPublic ? "translate-x-4" : "translate-x-0"}`} />
                  </button>
                </div>
                {selectedDb.fields.map(f => (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{f.label}</Label>
                    <div className="relative">
                      <Input
                        type={f.password && !showPasswords[f.key] ? "password" : "text"}
                        value={dbValues[f.key] ?? f.default}
                        onChange={e => setDbValues(p => ({ ...p, [f.key]: e.target.value }))}
                        className="h-8 text-xs pr-8"
                      />
                      {f.password && (
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          onClick={() => setShowPasswords(p => ({ ...p, [f.key]: !p[f.key] }))}
                        >
                          {showPasswords[f.key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {selectedDb.extraPorts && (
                  <p className="text-[10px] text-muted-foreground">
                    Additional ports: {selectedDb.extraPorts.join(", ")} (auto-mapped)
                  </p>
                )}
                {selectedDb.hasAdminPanel && (
                  <div className="rounded-lg border border-border overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2">
                      <div>
                        <p className="text-xs font-medium">Include Adminer web panel</p>
                        <p className="text-[10px] text-muted-foreground">Lightweight SQL admin UI — works with all SQL databases</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDbIncludeAdminer(p => !p)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${dbIncludeAdminer ? "bg-primary" : "bg-muted"}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${dbIncludeAdminer ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                    </div>
                    {dbIncludeAdminer && (
                      <div className="px-3 pb-3 border-t border-border/50 pt-2 space-y-1">
                        <label className="text-[10px] text-muted-foreground">Adminer host port</label>
                        <Input value={dbAdminerPort} onChange={e => setDbAdminerPort(e.target.value)} className="h-8 text-xs font-mono" />
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-2 justify-end pt-1">
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => setSelectedDb(null)}>Cancel</Button>
                  <Button
                    size="sm"
                    className="text-xs bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none"
                    onClick={deployDb}
                  >
                    <Play className="w-3 h-3 mr-1.5" />Deploy {selectedDb.name}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Log stream modal ──────────────────────────────────────────────── */}
      <LogModal
        open={showLog}
        onClose={() => setShowLog(false)}
        logs={logLines}
        done={logDone}
        ok={logOk}
        title={logTitle}
      />
    </div>
  );
}
