import React, { useEffect, useState } from "react";
import { Cpu, MemoryStick, HardDrive, Activity, Sun, Moon, RefreshCw, Server } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { useGetSystemStats } from "@/api/client";
import { getSocket } from "@/api/socket";
import { useQueryClient } from "@tanstack/react-query";

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
}

function formatUptime(secs: number): string {
  if (!secs) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.length ? parts.join(" ") : `${secs}s`;
}

export default function VpsPage() {
  const { theme, toggle } = useTheme();
  const { data, isLoading, refetch } = useGetSystemStats();
  const [livePoints, setLivePoints] = useState<{ timestamp: number; cpu: number; memory: number; load: number }[]>([]);
  const qc = useQueryClient();

  useEffect(() => {
    if (data?.history) setLivePoints(data.history);
  }, [data?.history?.length]);

  useEffect(() => {
    const socket = getSocket();
    const onStats = (point: { timestamp: number; cpu: number; memory: number; load: number }) => {
      setLivePoints(prev => {
        const next = [...prev, point];
        if (next.length > 60) next.shift();
        return next;
      });
    };
    socket.on("system-stats", onStats);
    return () => { socket.off("system-stats", onStats); };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <DesktopSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MobileSidebarTrigger />
              <div className="hidden lg:flex items-center gap-3">
                <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0">
                  <Server className="w-4 h-4 text-primary" />
                </div>
                <span className="font-medium text-sm tracking-tight text-foreground">VPS Management</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60" onClick={toggle}>
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
              <Button variant="outline" size="sm" className="h-8 rounded-full border-border hover:bg-muted font-medium text-xs text-foreground bg-transparent" onClick={() => { refetch(); qc.invalidateQueries({ queryKey: ["system-stats"] }); }}>
                <RefreshCw className="w-3.5 h-3.5 mr-2" />Refresh
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-8 space-y-8 pb-24 max-w-6xl w-full mx-auto">
          <div className="flex flex-col gap-2 mb-10">
            <h1 className="text-4xl sm:text-5xl font-normal tracking-tight text-foreground leading-none">VPS Management</h1>
            <p className="text-muted-foreground text-sm max-w-xl leading-relaxed">
              Live CPU, memory, storage, and load metrics for the host server.
            </p>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              title="CPU Usage"
              value={isLoading ? "—" : `${data?.cpu.load.toFixed(1)}%`}
              sub={isLoading ? "—" : `${data?.cpu.cores} cores · ${data?.cpu.model.slice(0, 30)}`}
              percent={data?.cpu.load ?? 0}
              icon={<Cpu className="w-4 h-4 text-muted-foreground" />}
            />
            <StatCard
              title="Memory"
              value={isLoading ? "—" : `${data?.memory.usedPercent.toFixed(1)}%`}
              sub={isLoading ? "—" : `${formatBytes(data?.memory.used || 0)} / ${formatBytes(data?.memory.total || 0)}`}
              percent={data?.memory.usedPercent ?? 0}
              icon={<MemoryStick className="w-4 h-4 text-muted-foreground" />}
            />
            <StatCard
              title="Storage"
              value={isLoading ? "—" : `${data?.storage.usedPercent.toFixed(1)}%`}
              sub={isLoading ? "—" : `${formatBytes(data?.storage.used || 0)} / ${formatBytes(data?.storage.total || 0)}`}
              percent={data?.storage.usedPercent ?? 0}
              icon={<HardDrive className="w-4 h-4 text-muted-foreground" />}
            />
            <StatCard
              title="System Load"
              value={isLoading ? "—" : `${(data?.load.avgLoad ?? 0).toFixed(2)}`}
              sub={isLoading ? "—" : `Up ${formatUptime(data?.os.uptime || 0)}`}
              percent={Math.min(100, ((data?.load.avgLoad ?? 0) / Math.max(1, data?.cpu.cores ?? 1)) * 100)}
              icon={<Activity className="w-4 h-4 text-muted-foreground" />}
            />
          </div>

          {/* OS Info */}
          <Card className="bg-background border-border shadow-none rounded-xl">
            <CardHeader className="p-6 pb-2">
              <CardTitle className="text-base font-medium tracking-tight">Host Information</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">{isLoading ? "Loading..." : `${data?.os.distro} ${data?.os.release} · ${data?.os.arch}`}</CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <InfoRow label="Hostname" value={data?.os.hostname || "—"} />
                <InfoRow label="Platform" value={data?.os.platform || "—"} />
                <InfoRow label="CPU Speed" value={data?.cpu.speed ? `${data.cpu.speed.toFixed(2)} GHz` : "—"} />
                <InfoRow label="Uptime" value={formatUptime(data?.os.uptime || 0)} />
              </div>
            </CardContent>
          </Card>

          {/* CPU & Memory chart */}
          <Card className="bg-background border-border shadow-none rounded-xl">
            <CardHeader className="p-6 pb-2">
              <CardTitle className="text-base font-medium tracking-tight">CPU & Memory (Live)</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">Streaming via WebSocket every 3s</CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="h-[280px] w-full">
                {isLoading && livePoints.length === 0 ? <Skeleton className="w-full h-full bg-muted" /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={livePoints} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="timestamp" tickFormatter={(t) => format(new Date(t), "HH:mm:ss")} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} domain={[0, 100]} />
                      <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', borderRadius: '6px', fontSize: '12px' }} labelFormatter={(t) => format(new Date(t as number), "HH:mm:ss")} />
                      <Area type="monotone" dataKey="cpu" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.18} strokeWidth={2} name="CPU %" isAnimationActive={false} />
                      <Area type="monotone" dataKey="memory" stroke="hsl(var(--chart-2))" fill="hsl(var(--chart-2))" fillOpacity={0.18} strokeWidth={2} name="Memory %" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Load average chart */}
          <Card className="bg-background border-border shadow-none rounded-xl">
            <CardHeader className="p-6 pb-2">
              <CardTitle className="text-base font-medium tracking-tight">System Load (Live)</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">Average load over time</CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="h-[220px] w-full">
                {isLoading && livePoints.length === 0 ? <Skeleton className="w-full h-full bg-muted" /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={livePoints} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="timestamp" tickFormatter={(t) => format(new Date(t), "HH:mm:ss")} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', borderRadius: '6px', fontSize: '12px' }} labelFormatter={(t) => format(new Date(t as number), "HH:mm:ss")} />
                      <Line type="monotone" dataKey="load" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} name="Load" isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}

function StatCard({ title, value, sub, percent, icon }: { title: string; value: string; sub: string; percent: number; icon: React.ReactNode }) {
  return (
    <Card className="bg-background border-border shadow-none rounded-lg overflow-hidden relative group">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground tracking-wide">{title}</p>
          {icon}
        </div>
        <p className="text-2xl font-normal tracking-tight text-foreground">{value}</p>
        <Progress value={Math.min(100, Math.max(0, percent))} className="h-1.5" />
        <p className="text-[11px] text-muted-foreground truncate">{sub}</p>
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="font-mono text-sm text-foreground truncate">{value}</span>
    </div>
  );
}
