import React, { useState } from "react";
import { Sun, Moon, Container, Play, Square, RotateCw, Trash2, RefreshCw, AlertTriangle, Loader2, Cpu, MemoryStick } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { useLocation } from "wouter";
import {
  useGetDockerStatus, useGetDockerContainers,
  dockerStart, dockerStop, dockerRestart, dockerRemove, dockerBulk,
  getContainerStats,
  type DockerContainer, type ContainerStats,
} from "@/api/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useCallback } from "react";

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

function ContainerStats({ id, running }: { id: string; running: boolean }) {
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

// ── Docker SVG Logo ───────────────────────────────────────────────────────────
function DockerLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 17" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="6" width="3" height="3" rx="0.4" fill="currentColor"/>
      <rect x="4" y="6" width="3" height="3" rx="0.4" fill="currentColor"/>
      <rect x="8" y="6" width="3" height="3" rx="0.4" fill="currentColor"/>
      <rect x="12" y="6" width="3" height="3" rx="0.4" fill="currentColor"/>
      <rect x="8" y="2" width="3" height="3" rx="0.4" fill="currentColor"/>
      <rect x="12" y="2" width="3" height="3" rx="0.4" fill="currentColor"/>
      <rect x="4" y="10" width="3" height="3" rx="0.4" fill="currentColor"/>
      <rect x="0" y="10" width="3" height="3" rx="0.4" fill="currentColor"/>
      <path d="M22 8.5C21.5 7 20 6.5 18.5 6.5C18 4.5 16.5 3.5 14.5 3.5V6.5H16V9.5H1C1 12 2.5 14 5 14.5C7.5 15 21 15 22 13C23 11 22.5 10 22 8.5Z" fill="currentColor" opacity="0.35"/>
    </svg>
  );
}

// ── Container Card ────────────────────────────────────────────────────────────
function ContainerCard({
  container,
  busy,
  onAction,
  onClick,
}: {
  container: DockerContainer;
  busy: string | null;
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
      {/* Status bar */}
      <div className={`h-0.5 w-full ${running ? "bg-primary" : "bg-muted"}`} />

      <div className="p-5">
        {/* Top: logo + name + status */}
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

        {/* Stats */}
        <div className="flex items-center justify-between mb-4">
          <ContainerStats id={container.id} running={running} />
          <span className="text-[10px] text-muted-foreground font-mono">{container.shortId}</span>
        </div>

        {/* Meta */}
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

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 pt-3 border-t border-border/60" onClick={e => e.stopPropagation()}>
          {busy === container.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground mr-1 shrink-0" />}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10"
            disabled={running || busy === container.id}
            title="Start"
            onClick={e => onAction(container.id, dockerStart, "Start", e)}
          >
            <Play className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"
            disabled={!running || busy === container.id}
            title="Stop"
            onClick={e => onAction(container.id, dockerStop, "Stop", e)}
          >
            <Square className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10"
            disabled={busy === container.id}
            title="Restart"
            onClick={e => onAction(container.id, dockerRestart, "Restart", e)}
          >
            <RotateCw className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            disabled={busy === container.id}
            title="Remove"
            onClick={e => onAction(container.id, dockerRemove, "Remove", e)}
          >
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

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function DockerPage() {
  const { theme, toggle } = useTheme();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { data: status } = useGetDockerStatus();
  const { data: containersData, isLoading } = useGetDockerContainers();
  const [bulkAction, setBulkAction] = useState<"start" | "stop" | "restart" | "remove" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["docker-containers"] });
    qc.invalidateQueries({ queryKey: ["docker-status"] });
  };

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

  const containers = containersData?.containers || [];
  const dockerOk = status?.available !== false;

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <DesktopSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="px-4 h-14 flex items-center justify-between">
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

          {/* Bulk Actions */}
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

          {/* Container Cards */}
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

      {/* Bulk confirm */}
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
    </div>
  );
}
