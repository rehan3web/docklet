import React, { useState, useRef, useEffect, useCallback } from "react";
import { Sun, Moon, Container, Play, Square, RotateCw, Trash2, RefreshCw, AlertTriangle, Loader2, MoreHorizontal, FileText, Network, HardDrive, Terminal, X } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import {
  useGetDockerStatus, useGetDockerContainers,
  dockerStart, dockerStop, dockerRestart, dockerRemove, dockerBulk,
  dockerLogs, dockerInspect,
  type DockerContainer,
} from "@/api/client";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket } from "@/api/socket";

// ── strip ANSI / VT escape sequences (including bracketed paste mode) ──────────
function stripAnsi(str: string): string {
  return str
    // CSI sequences: ESC [ ... (any params/intermediates) ... final-byte
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, "")
    // OSC sequences: ESC ] ... ST or BEL
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, "")
    // 2-char ESC sequences
    .replace(/\x1B[@-Z\\-_]/g, "")
    // C1 control codes
    .replace(/[\x80-\x9F]/g, "")
    // carriage returns
    .replace(/\r/g, "");
}

// ── Logs Dialog ───────────────────────────────────────────────────────────────
function LogsDialog({ container, open, onClose }: { container: DockerContainer; open: boolean; onClose: () => void }) {
  const [logs, setLogs] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setLogs("");
    dockerLogs(container.id).then(r => {
      setLogs(r.logs || "(no logs)");
    }).catch(err => {
      setLogs(`Error: ${err.message}`);
    }).finally(() => setLoading(false));
  }, [open, container.id]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[760px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-5 pb-3 border-b border-border">
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            Logs — {container.names[0] || container.shortId}
          </DialogTitle>
          <DialogDescription className="text-xs">Last 300 lines (stdout + stderr)</DialogDescription>
        </DialogHeader>
        <div className="h-[480px] overflow-hidden bg-[#0d0d0d]">
          {loading ? (
            <div className="h-full flex items-center justify-center gap-2 text-muted-foreground text-xs">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading logs…
            </div>
          ) : (
            <pre ref={logRef} className="font-mono text-[11px] text-green-400 p-4 h-full overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {logs}
            </pre>
          )}
        </div>
        <div className="p-4 border-t border-border flex justify-end">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Network Dialog ────────────────────────────────────────────────────────────
function NetworkDialog({ container, open, onClose }: { container: DockerContainer; open: boolean; onClose: () => void }) {
  const [data, setData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    dockerInspect(container.id).then(r => setData(r.networks || {})).catch(() => setData({})).finally(() => setLoading(false));
  }, [open, container.id]);

  const networks = Object.entries(data);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[620px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-5 pb-3 border-b border-border">
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <Network className="w-4 h-4 text-muted-foreground" />
            Network — {container.names[0] || container.shortId}
          </DialogTitle>
          <DialogDescription className="text-xs">Network configuration for this container</DialogDescription>
        </DialogHeader>
        <div className="h-[380px] overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-muted-foreground text-xs py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : networks.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">No network data available</p>
          ) : (
            <div className="space-y-4">
              {networks.map(([name, net]) => (
                <div key={name} className="rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-2 bg-muted/40 border-b border-border">
                    <span className="font-mono text-xs font-medium text-foreground">{name}</span>
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {[
                        ["IP Address", net.IPAddress],
                        ["Gateway", net.Gateway],
                        ["Subnet", net.IPPrefixLen ? `/${net.IPPrefixLen}` : "—"],
                        ["MAC Address", net.MacAddress],
                        ["Network ID", net.NetworkID?.slice(0, 16)],
                        ["Endpoint ID", net.EndpointID?.slice(0, 16)],
                      ].filter(([, v]) => v).map(([k, v]) => (
                        <tr key={k} className="border-b border-border/50 last:border-0">
                          <td className="px-4 py-2 text-muted-foreground w-32 shrink-0">{k}</td>
                          <td className="px-4 py-2 font-mono text-foreground">{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-border flex justify-end">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Mounts Dialog ─────────────────────────────────────────────────────────────
function MountsDialog({ container, open, onClose }: { container: DockerContainer; open: boolean; onClose: () => void }) {
  const [mounts, setMounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    dockerInspect(container.id).then(r => setMounts(r.mounts || [])).catch(() => setMounts([])).finally(() => setLoading(false));
  }, [open, container.id]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[680px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-5 pb-3 border-b border-border">
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-muted-foreground" />
            Mounts — {container.names[0] || container.shortId}
          </DialogTitle>
          <DialogDescription className="text-xs">Volume and bind mounts for this container</DialogDescription>
        </DialogHeader>
        <div className="h-[380px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-muted-foreground text-xs py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : mounts.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">No mounts configured</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-medium">Type</th>
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-medium">Source</th>
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-medium">Destination</th>
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-medium">Mode</th>
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-medium">RW</th>
                </tr>
              </thead>
              <tbody>
                {mounts.map((m, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-foreground">{m.Type}</td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground truncate max-w-[160px]" title={m.Source}>{m.Source || m.Name || "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-foreground truncate max-w-[160px]" title={m.Destination}>{m.Destination}</td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground">{m.Mode || "—"}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={`text-[10px] rounded-full px-2 py-0 font-mono ${m.RW ? "text-primary bg-primary/10 border-primary/20" : "text-muted-foreground bg-muted/40"}`}>
                        {m.RW ? "rw" : "ro"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="p-4 border-t border-border flex justify-end">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Container Terminal Dialog ─────────────────────────────────────────────────
function TerminalDialog({ container, open, onClose }: { container: DockerContainer; open: boolean; onClose: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const socket = getSocket();

  const appendOutput = useCallback((text: string) => {
    const cleaned = stripAnsi(text);
    setLines(prev => {
      const all = (prev.join("\n") + cleaned).split("\n");
      return all.slice(-500);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    setLines([]);
    setError(null);
    setConnected(false);

    socket.emit("docker:exec:start", { containerId: container.id, rows: 40, cols: 120 });

    const onReady = () => { setConnected(true); inputRef.current?.focus(); };
    const onData = (data: string) => appendOutput(data);
    const onExit = () => { setConnected(false); appendOutput("\n[Process exited]"); };
    const onError = ({ message }: { message: string }) => { setError(message); setConnected(false); };

    socket.on("docker:exec:ready", onReady);
    socket.on("docker:exec:data", onData);
    socket.on("docker:exec:exit", onExit);
    socket.on("docker:exec:error", onError);

    return () => {
      socket.emit("docker:exec:stop");
      socket.off("docker:exec:ready", onReady);
      socket.off("docker:exec:data", onData);
      socket.off("docker:exec:exit", onExit);
      socket.off("docker:exec:error", onError);
    };
  }, [open, container.id]);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [lines]);

  function sendInput(e: React.FormEvent) {
    e.preventDefault();
    if (!connected) return;
    socket.emit("docker:exec:input", input + "\n");
    setInput("");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[760px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 pb-3 border-b border-border">
          <DialogTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
            <Terminal className="w-4 h-4 text-muted-foreground shrink-0" />
            Terminal — {container.names[0] || container.shortId}
            <span className="text-muted-foreground/40 font-normal">·</span>
            <span className="text-xs text-muted-foreground font-normal">
              {connected ? "Connected — type commands and press Enter" : error ? `Error: ${error}` : "Connecting…"}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div
          ref={outputRef}
          className="h-[380px] overflow-y-auto bg-[#0d0d0d] p-4 font-mono text-[12px] text-green-400 leading-relaxed cursor-text"
          onClick={() => inputRef.current?.focus()}
        >
          {lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
          ))}
          {!connected && !error && (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Loader2 className="w-3 h-3 animate-spin" /> Connecting to container shell…
            </div>
          )}
          {error && <div className="text-red-400 text-xs">{error}</div>}
        </div>

        <form onSubmit={sendInput} className="border-t border-border bg-[#111] flex items-center px-3 py-2 gap-2">
          <span className="font-mono text-xs text-green-500 shrink-0">$</span>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "c" && e.ctrlKey) { socket.emit("docker:exec:input", "\x03"); setInput(""); e.preventDefault(); }
              if (e.key === "l" && e.ctrlKey) { setLines([]); e.preventDefault(); }
            }}
            className="flex-1 bg-transparent font-mono text-xs text-green-400 outline-none placeholder:text-muted-foreground/30"
            placeholder={connected ? "Type a command…" : "Waiting for connection…"}
            disabled={!connected}
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground" disabled={!connected || !input.trim()}>
            <Play className="w-3 h-3" />
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Three-dot menu ────────────────────────────────────────────────────────────
type DialogType = "logs" | "network" | "mounts" | "terminal" | null;

function ContainerMenu({ container, onSelect }: { container: DockerContainer; onSelect: (type: DialogType) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={() => onSelect("logs")}>
          <FileText className="w-3.5 h-3.5" /> View Logs
        </DropdownMenuItem>
        <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={() => onSelect("network")}>
          <Network className="w-3.5 h-3.5" /> View Network
        </DropdownMenuItem>
        <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={() => onSelect("mounts")}>
          <HardDrive className="w-3.5 h-3.5" /> View Mounts
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={() => onSelect("terminal")} disabled={container.state !== "running"}>
          <Terminal className="w-3.5 h-3.5" /> Open Terminal
          {container.state !== "running" && <span className="ml-auto text-[10px] text-muted-foreground">not running</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DockerPage() {
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const { data: status } = useGetDockerStatus();
  const { data: containersData, isLoading } = useGetDockerContainers();
  const [bulkAction, setBulkAction] = useState<"start" | "stop" | "restart" | "remove" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [activeContainer, setActiveContainer] = useState<DockerContainer | null>(null);
  const [activeDialog, setActiveDialog] = useState<DialogType>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["docker-containers"] });
    qc.invalidateQueries({ queryKey: ["docker-status"] });
  };

  function openDialog(container: DockerContainer, type: DialogType) {
    setActiveContainer(container);
    setActiveDialog(type);
  }

  function closeDialog() {
    setActiveDialog(null);
    setActiveContainer(null);
  }

  async function action(id: string, fn: (id: string) => Promise<void>, label: string) {
    setBusy(id);
    try {
      await fn(id);
      toast.success(`${label} succeeded`);
      refresh();
    } catch (err: any) {
      toast.error(err.message || `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  async function runBulk() {
    if (!bulkAction) return;
    try {
      const r = await dockerBulk(bulkAction);
      const failed = r.results.filter(x => !x.ok).length;
      if (failed) toast.warning(`${bulkAction} completed with ${failed} failure(s)`);
      else toast.success(`Bulk ${bulkAction} succeeded`);
      refresh();
    } catch (err: any) {
      toast.error(err.message || "Bulk action failed");
    } finally {
      setBulkAction(null);
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
                <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0">
                  <Container className="w-4 h-4 text-primary" />
                </div>
                <span className="font-medium text-sm tracking-tight text-foreground">Docker Manager</span>
                {status?.available && (
                  <Badge variant="outline" className="font-mono text-[10px] uppercase rounded-full px-2 py-0 text-primary bg-primary/10 border-primary/20">
                    {status.serverVersion}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60" onClick={toggle}>
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
              Manage containers running on the host: start, stop, restart, or remove containers individually or in bulk.
            </p>
          </div>

          {!dockerOk && (
            <Card className="bg-amber-500/10 border-amber-500/30 shadow-none rounded-xl">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1 text-sm">
                  <p className="font-medium text-foreground mb-1">Docker is not available</p>
                  <p className="text-xs text-muted-foreground">{status?.reason || "The Docker socket is not reachable. Install Docker on your VPS to enable this feature."}</p>
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

          <Card className="bg-background border-border shadow-none rounded-xl">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium tracking-tight">Bulk Actions</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">Apply an action to all containers at once.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-2 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={!dockerOk} onClick={() => setBulkAction("start")}><Play className="w-3.5 h-3.5 mr-1" />Start All</Button>
              <Button variant="outline" size="sm" disabled={!dockerOk} onClick={() => setBulkAction("stop")}><Square className="w-3.5 h-3.5 mr-1" />Stop All</Button>
              <Button variant="outline" size="sm" disabled={!dockerOk} onClick={() => setBulkAction("restart")}><RotateCw className="w-3.5 h-3.5 mr-1" />Restart All</Button>
              <Button variant="destructive" size="sm" disabled={!dockerOk} onClick={() => setBulkAction("remove")}><Trash2 className="w-3.5 h-3.5 mr-1" />Remove All</Button>
            </CardContent>
          </Card>

          <Card className="bg-background border-border shadow-none rounded-xl overflow-hidden">
            <CardHeader className="p-4 pb-3 border-b border-border/50">
              <CardTitle className="text-sm font-medium tracking-tight">Containers</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-xs font-medium text-muted-foreground px-6">NAME</TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground px-6">IMAGE</TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground px-6">STATE</TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground px-6">CREATED</TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground px-6 text-right">ACTIONS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={5} className="px-6"><Skeleton className="h-4 w-full bg-muted" /></TableCell></TableRow>
                  ))
                ) : containers.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">{dockerOk ? "No containers" : "Docker is not available."}</TableCell></TableRow>
                ) : (
                  containers.map((c) => (
                    <TableRow key={c.id} className="border-border hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono text-xs text-foreground px-6 truncate">{c.names[0] || c.shortId}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground px-6 truncate">{c.image}</TableCell>
                      <TableCell className="px-6">
                        <Badge variant="outline" className={`font-mono text-[10px] uppercase rounded-full px-2 py-0 ${c.state === 'running' ? 'text-primary bg-primary/10 border-primary/20' : 'text-muted-foreground bg-muted/50'}`}>
                          {c.state}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground px-6 whitespace-nowrap">{format(new Date(c.createdAt), "MMM dd, HH:mm")}</TableCell>
                      <TableCell className="px-6 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {busy === c.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground mr-1" />}
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={c.state === 'running' || busy === c.id} title="Start" onClick={() => action(c.id, dockerStart, "Start")}>
                            <Play className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={c.state !== 'running' || busy === c.id} title="Stop" onClick={() => action(c.id, dockerStop, "Stop")}>
                            <Square className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={busy === c.id} title="Restart" onClick={() => action(c.id, dockerRestart, "Restart")}>
                            <RotateCw className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" disabled={busy === c.id} title="Remove" onClick={() => action(c.id, dockerRemove, "Remove")}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                          <ContainerMenu container={c} onSelect={(type) => openDialog(c, type)} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </main>
      </div>

      {/* Bulk confirm */}
      <AlertDialog open={!!bulkAction} onOpenChange={(o) => { if (!o) setBulkAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm bulk {bulkAction}</AlertDialogTitle>
            <AlertDialogDescription>
              This will {bulkAction} <span className="font-semibold">all</span> containers on the host. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runBulk}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Contextual dialogs */}
      {activeContainer && activeDialog === "logs" && (
        <LogsDialog container={activeContainer} open={true} onClose={closeDialog} />
      )}
      {activeContainer && activeDialog === "network" && (
        <NetworkDialog container={activeContainer} open={true} onClose={closeDialog} />
      )}
      {activeContainer && activeDialog === "mounts" && (
        <MountsDialog container={activeContainer} open={true} onClose={closeDialog} />
      )}
      {activeContainer && activeDialog === "terminal" && (
        <TerminalDialog container={activeContainer} open={true} onClose={closeDialog} />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="bg-background border-border shadow-none rounded-lg">
      <CardContent className="p-5">
        <p className="text-xs font-medium text-muted-foreground tracking-wide mb-2">{label}</p>
        <p className="text-2xl font-normal tracking-tight text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}
