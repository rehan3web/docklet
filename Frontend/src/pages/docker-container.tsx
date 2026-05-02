import React, { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Play, Square, RotateCw, Trash2, Loader2, Network, HardDrive, Terminal, KeyRound, Clock, Globe, RefreshCw, FileText, Rocket, Cpu, MemoryStick, Container, Sun, Moon, AlertTriangle, CheckCircle, XCircle, Copy, Code2, ChevronDown, ChevronUp, ShieldCheck, ExternalLink, Plus, EyeOff, History, ChevronRight, ToggleLeft, ToggleRight, Save, RotateCcw, Database, Zap, ChevronLeft, Sparkles, Bot, User, Send, Info, TriangleAlert, CircleCheck, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { copyToClipboard } from "@/lib/utils";
import MarkdownContent from "@/components/MarkdownContent";
import { getSocket } from "@/api/socket";
import { Link } from "wouter";
import {
  useGetDockerContainers,
  dockerStart, dockerStop, dockerRestart, dockerRemove,
  dockerInspect, dockerLogs,
  useGetContainerEnv, containerEnvSet, containerEnvDelete, containerEnvApply, containerEnvVersions, containerEnvRollback,
  useGetContainerSchedules, containerScheduleCreate, containerScheduleUpdate, containerScheduleDelete, containerScheduleRun, containerScheduleLogs,
  containerDomainGet, containerDomainAssign, containerDomainNginx, containerDomainDelete, containerDomainRegenerate, containerDomainTraefik, traefikComposeSnippet,
  useGetBaseDomain, baseDomainSave, useGetVerifiedDomains,
  useGetContainerBackups, containerBackupCreate, containerBackupUpdate, containerBackupDelete, containerBackupRun, containerBackupLogs, containerBackupS3Files, containerRestore,
  useIsStorageConfigured,
  useGetAiSettings, aiAnalyzeLogs, aiChat,
  type DockerContainer, type ContainerEnvVar, type EnvVersion, type ContainerSchedule, type ContainerScheduleLog, type ContainerDomain, type VerifiedDomain, type ContainerBackup, type ContainerBackupLog, type S3BackupFile, type AiAnalysis,
} from "@/api/client";

// ── Helpers ───────────────────────────────────────────────────────────────────
function stripAnsi(str: string): string {
  return str
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B[PX^_][^\x1B]*(?:\x1B\\)/g, "")
    .replace(/\x1B[ -/]+[@-~]/g, "")
    .replace(/\x1B[@-~]/g, "")
    .replace(/\x1B/g, "")
    .replace(/[\x80-\x9F]/g, "")
    .replace(/\r/g, "");
}

function fmtAge(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const TABS = [
  { id: "action",      label: "Action",      icon: Rocket },
  { id: "terminal",    label: "Terminal",    icon: Terminal },
  { id: "environment", label: "Environment", icon: KeyRound },
  { id: "schedule",    label: "Schedule",    icon: Clock },
  { id: "domain",      label: "Domain",      icon: Globe },
  { id: "backup",      label: "Backup",      icon: HardDrive },
  { id: "ai",          label: "AI",          icon: Sparkles },
];

// ── Action Tab ────────────────────────────────────────────────────────────────
function ActionTab({ container, onRefresh }: { container: DockerContainer; onRefresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [mountsOpen, setMountsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [inspectData, setInspectData] = useState<{ networks: Record<string, any>; mounts: any[] } | null>(null);
  const [logs, setLogs] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const [aiSummary, setAiSummary] = useState<AiAnalysis | null>(null);
  const [aiSummarizing, setAiSummarizing] = useState(false);

  async function act(fn: () => Promise<void>, label: string) {
    setBusy(label);
    try { await fn(); toast.success(`${label} succeeded`); onRefresh(); }
    catch (err: any) { toast.error(err.message || `${label} failed`); }
    finally { setBusy(null); }
  }

  async function openNetwork() {
    setNetworkOpen(true);
    if (!inspectData) {
      const r = await dockerInspect(container.id).catch(() => ({ networks: {}, mounts: [] }));
      setInspectData(r as any);
    }
  }

  async function openMounts() {
    setMountsOpen(true);
    if (!inspectData) {
      const r = await dockerInspect(container.id).catch(() => ({ networks: {}, mounts: [] }));
      setInspectData(r as any);
    }
  }

  async function openLogs() {
    setLogsOpen(true);
    setLogsLoading(true);
    setAiSummary(null);
    setLogs("");
    dockerLogs(container.id).then(r => setLogs(r.logs || "(no logs)")).catch(e => setLogs(`Error: ${e.message}`)).finally(() => setLogsLoading(false));
  }

  async function handleAiSummarizeLogs() {
    if (!logs || logsLoading) return;
    setAiSummarizing(true);
    try {
      const result = await aiAnalyzeLogs({
        logs,
        containerName: (container.names[0] || container.shortId).replace(/^\//, ""),
        containerState: container.state,
        containerImage: container.image,
      });
      setAiSummary(result);
    } catch (err: any) {
      toast.error(err.message || "AI analysis failed");
    } finally {
      setAiSummarizing(false);
    }
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const running = container.state === "running";

  return (
    <div className="space-y-6">
      {/* Primary actions */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 bg-muted/30 border-b border-border">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Container Actions</span>
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ActionButton
            icon={<Play className="w-4 h-4" />}
            label="Start"
            disabled={running || !!busy}
            loading={busy === "Start"}
            onClick={() => act(() => dockerStart(container.id), "Start")}
            color="green"
          />
          <ActionButton
            icon={<Square className="w-4 h-4" />}
            label="Stop"
            disabled={!running || !!busy}
            loading={busy === "Stop"}
            onClick={() => act(() => dockerStop(container.id), "Stop")}
            color="amber"
          />
          <ActionButton
            icon={<RotateCw className="w-4 h-4" />}
            label="Restart"
            disabled={!!busy}
            loading={busy === "Restart"}
            onClick={() => act(() => dockerRestart(container.id), "Restart")}
            color="blue"
          />
          <ActionButton
            icon={<Rocket className="w-4 h-4" />}
            label="Redeploy"
            disabled={!!busy}
            loading={busy === "Redeploy"}
            onClick={() => act(() => dockerRestart(container.id), "Redeploy")}
            color="purple"
          />
        </div>
        <div className="px-4 pb-4">
          <Button
            variant="destructive"
            size="sm"
            className="h-8 text-xs gap-1.5"
            disabled={!!busy}
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove Container
          </Button>
        </div>
      </div>

      {/* View actions */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 bg-muted/30 border-b border-border">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">View & Inspect</span>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Button variant="outline" className="h-10 text-xs gap-2 justify-start px-4" onClick={openLogs}>
            <FileText className="w-4 h-4 text-muted-foreground" />View Logs
          </Button>
          <Button variant="outline" className="h-10 text-xs gap-2 justify-start px-4" onClick={openNetwork}>
            <Network className="w-4 h-4 text-muted-foreground" />View Network
          </Button>
          <Button variant="outline" className="h-10 text-xs gap-2 justify-start px-4" onClick={openMounts}>
            <HardDrive className="w-4 h-4 text-muted-foreground" />View Mounts
          </Button>
        </div>
      </div>

      {/* Container info */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 bg-muted/30 border-b border-border">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Container Details</span>
        </div>
        <table className="w-full text-xs">
          <tbody>
            {[
              ["ID", container.shortId],
              ["Image", container.image],
              ["State", container.state],
              ["Status", container.status],
              ["Created", format(new Date(container.createdAt), "MMM dd yyyy, HH:mm")],
              ["Ports", container.ports?.map((p: any) => `${p.PublicPort || ""}:${p.PrivatePort || ""}/${p.Type || ""}`).join(", ") || "—"],
            ].map(([k, v]) => (
              <tr key={k} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-2.5 text-muted-foreground w-32 font-medium">{k}</td>
                <td className="px-4 py-2.5 font-mono text-foreground break-all">{v as string || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Confirm remove */}
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove container?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove <strong>{container.names[0] || container.shortId}</strong>. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => { setConfirmRemove(false); act(() => dockerRemove(container.id), "Remove"); }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Logs dialog */}
      <Dialog open={logsOpen} onOpenChange={o => { if (!o) { setLogsOpen(false); setAiSummary(null); } }}>
        <DialogContent className="sm:max-w-[800px] p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-5 pb-3 border-b border-border">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-sm font-medium flex items-center gap-2"><FileText className="w-4 h-4 text-muted-foreground" />Logs — {container.names[0] || container.shortId}</DialogTitle>
                <DialogDescription className="text-xs mt-0.5">Last 300 lines (stdout + stderr)</DialogDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5 shrink-0"
                onClick={handleAiSummarizeLogs}
                disabled={logsLoading || aiSummarizing || !logs}
              >
                {aiSummarizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-violet-500" />}
                AI Summarize
              </Button>
            </div>
          </DialogHeader>

          {/* AI Summary Panel */}
          {aiSummary && (
            <div className="border-b border-border bg-muted/20 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-500" />
                <span className="text-xs font-semibold text-violet-600 dark:text-violet-400">AI Analysis</span>
                <Badge className={`text-[10px] rounded-full px-2 py-0 ${
                  aiSummary.health === "healthy" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" :
                  aiSummary.health === "error" ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" :
                  aiSummary.health === "warning" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" :
                  "bg-muted text-muted-foreground border-border"
                }`}>
                  {aiSummary.health === "healthy" ? "✓ Healthy" : aiSummary.health === "error" ? "✗ Error" : aiSummary.health === "warning" ? "⚠ Warning" : "? Unknown"}
                </Badge>
                <span className="text-[10px] text-muted-foreground ml-auto font-mono">{aiSummary.model?.split("/").pop()}</span>
              </div>
              <p className="text-xs text-foreground leading-relaxed">{aiSummary.summary}</p>
              {aiSummary.crashReason && (
                <div className="flex gap-2 bg-red-500/5 border border-red-500/20 rounded-lg p-2.5">
                  <TriangleAlert className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-600 dark:text-red-400">{aiSummary.crashReason}</p>
                </div>
              )}
              {aiSummary.issues?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Issues</p>
                  {aiSummary.issues.map((issue, i) => (
                    <div key={i} className="flex gap-2 text-xs text-foreground">
                      <span className="text-amber-500 shrink-0">•</span>{issue}
                    </div>
                  ))}
                </div>
              )}
              {aiSummary.recommendations?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Recommendations</p>
                  {aiSummary.recommendations.map((rec, i) => (
                    <div key={i} className="flex gap-2 text-xs text-foreground">
                      <Lightbulb className="w-3 h-3 text-violet-500 shrink-0 mt-0.5" />{rec}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="h-[360px] overflow-hidden bg-[#0d0d0d]">
            {logsLoading ? <div className="h-full flex items-center justify-center gap-2 text-muted-foreground text-xs"><Loader2 className="w-4 h-4 animate-spin" />Loading logs…</div>
              : <pre ref={logRef} className="font-mono text-[11px] text-green-400 p-4 h-full overflow-y-auto whitespace-pre-wrap leading-relaxed">{logs}</pre>}
          </div>
          <div className="p-4 border-t border-border flex justify-end">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setLogsOpen(false); setAiSummary(null); }}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Network dialog */}
      <Dialog open={networkOpen} onOpenChange={o => { if (!o) setNetworkOpen(false); }}>
        <DialogContent className="sm:max-w-[620px] p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-5 pb-3 border-b border-border">
            <DialogTitle className="text-sm font-medium flex items-center gap-2"><Network className="w-4 h-4 text-muted-foreground" />Network — {container.names[0] || container.shortId}</DialogTitle>
          </DialogHeader>
          <div className="h-[380px] overflow-y-auto p-4">
            {!inspectData ? <div className="flex items-center justify-center gap-2 text-muted-foreground text-xs py-8"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
              : Object.entries(inspectData.networks || {}).length === 0 ? <p className="text-xs text-muted-foreground text-center py-8">No network data available</p>
              : <div className="space-y-4">{Object.entries(inspectData.networks).map(([name, net]: any) => (
                <div key={name} className="rounded-lg border border-border overflow-hidden">
                  <div className="px-4 py-2 bg-muted/40 border-b border-border"><span className="font-mono text-xs font-medium">{name}</span></div>
                  <table className="w-full text-xs"><tbody>
                    {[["IP Address", net.IPAddress], ["Gateway", net.Gateway], ["MAC Address", net.MacAddress]].filter(([, v]) => v).map(([k, v]) => (
                      <tr key={k} className="border-b border-border/50 last:border-0">
                        <td className="px-4 py-2 text-muted-foreground w-32">{k}</td>
                        <td className="px-4 py-2 font-mono">{v as string}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              ))}</div>}
          </div>
          <div className="p-4 border-t border-border flex justify-end"><Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setNetworkOpen(false)}>Close</Button></div>
        </DialogContent>
      </Dialog>

      {/* Mounts dialog */}
      <Dialog open={mountsOpen} onOpenChange={o => { if (!o) setMountsOpen(false); }}>
        <DialogContent className="sm:max-w-[680px] p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-5 pb-3 border-b border-border">
            <DialogTitle className="text-sm font-medium flex items-center gap-2"><HardDrive className="w-4 h-4 text-muted-foreground" />Mounts — {container.names[0] || container.shortId}</DialogTitle>
          </DialogHeader>
          <div className="h-[380px] overflow-y-auto">
            {!inspectData ? <div className="flex items-center justify-center gap-2 text-muted-foreground text-xs py-8"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
              : (inspectData.mounts || []).length === 0 ? <p className="text-xs text-muted-foreground text-center py-8">No mounts configured</p>
              : <table className="w-full text-xs"><thead><tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-2.5 text-left text-muted-foreground font-medium">Type</th>
                <th className="px-4 py-2.5 text-left text-muted-foreground font-medium">Source</th>
                <th className="px-4 py-2.5 text-left text-muted-foreground font-medium">Destination</th>
                <th className="px-4 py-2.5 text-left text-muted-foreground font-medium">RW</th>
              </tr></thead><tbody>
                {inspectData.mounts.map((m: any, i: number) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-mono">{m.Type}</td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground truncate max-w-[160px]">{m.Source || m.Name || "—"}</td>
                    <td className="px-4 py-2.5 font-mono truncate max-w-[160px]">{m.Destination}</td>
                    <td className="px-4 py-2.5"><Badge variant="outline" className={`text-[10px] rounded-full px-2 py-0 ${m.RW ? "text-primary bg-primary/10" : "text-muted-foreground"}`}>{m.RW ? "rw" : "ro"}</Badge></td>
                  </tr>
                ))}
              </tbody></table>}
          </div>
          <div className="p-4 border-t border-border flex justify-end"><Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setMountsOpen(false)}>Close</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ActionButton({ icon, label, disabled, loading, onClick, color }: { icon: React.ReactNode; label: string; disabled: boolean; loading: boolean; onClick: () => void; color: string }) {
  const colors: Record<string, string> = {
    green: "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20",
    amber: "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20",
    blue: "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20",
    purple: "bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20",
  };
  return (
    <button
      className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ${colors[color]}`}
      disabled={disabled}
      onClick={onClick}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {label}
    </button>
  );
}

// ── Terminal Tab ──────────────────────────────────────────────────────────────
function TerminalTab({ container }: { container: DockerContainer }) {
  const [lines, setLines] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const socket = getSocket();

  // AI assist
  const { data: aiSettings } = useGetAiSettings();
  const aiConfigured = aiSettings?.configured ?? false;
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);

  async function handleAiSuggest(e: React.FormEvent) {
    e.preventDefault();
    const prompt = aiPrompt.trim();
    if (!prompt || aiLoading) return;
    setAiLoading(true);
    setAiSuggestion(null);
    try {
      const containerName = (container.names[0] || container.shortId).replace(/^\//, "");
      const r = await aiChat(
        [{ role: "user", content: prompt }],
        `You are a Linux/Docker shell expert. The user is inside the container "${containerName}" (image: ${container.image}). ` +
        `They describe a task in natural language. Respond ONLY with a single shell command. No explanation, no markdown fences, no commentary.`
      );
      setAiSuggestion(r.content.replace(/^```(?:bash|sh|shell)?\s*/i, "").replace(/```\s*$/i, "").trim());
    } catch (err: any) {
      toast.error(err.message || "AI failed");
    } finally {
      setAiLoading(false);
    }
  }

  function useAiSuggestion() {
    if (aiSuggestion) {
      socket.emit("docker:exec:input", aiSuggestion + "\n");
      setAiSuggestion(null);
      setAiPrompt("");
    }
  }

  const appendOutput = useCallback((text: string) => {
    const cleaned = stripAnsi(text);
    setLines(prev => {
      const all = (prev.join("\n") + cleaned).split("\n");
      return all.slice(-500);
    });
  }, []);

  useEffect(() => {
    setLines([]);
    setError(null);
    setConnected(false);

    const onReady = () => { setConnected(true); inputRef.current?.focus(); };
    const onData = (data: string) => appendOutput(data);
    const onExit = () => { setConnected(false); appendOutput("\n[Process exited]"); };
    const onError = ({ message }: { message: string }) => { setError(message); setConnected(false); };

    // Register ALL listeners BEFORE emitting start, so no event is missed
    socket.on("docker:exec:ready", onReady);
    socket.on("docker:exec:data", onData);
    socket.on("docker:exec:exit", onExit);
    socket.on("docker:exec:error", onError);

    // Wait for connection if socket isn't ready yet
    function startExec() {
      socket.emit("docker:exec:start", { containerId: container.id, rows: 40, cols: 120 });
    }
    if (socket.connected) {
      startExec();
    } else {
      socket.once("connect", startExec);
    }

    // Frontend timeout: if no ready/error within 15s, show a helpful message
    const timeoutId = setTimeout(() => {
      setError("Connection timed out. The container may not have a shell (/bin/sh or /bin/bash).");
      setConnected(false);
    }, 15_000);
    const clearTimeout_ = () => clearTimeout(timeoutId);
    socket.once("docker:exec:ready", clearTimeout_);
    socket.once("docker:exec:error", clearTimeout_);

    return () => {
      clearTimeout(timeoutId);
      socket.off("connect", startExec);
      socket.off("docker:exec:ready", clearTimeout_);
      socket.off("docker:exec:error", clearTimeout_);
      socket.emit("docker:exec:stop");
      socket.off("docker:exec:ready", onReady);
      socket.off("docker:exec:data", onData);
      socket.off("docker:exec:exit", onExit);
      socket.off("docker:exec:error", onError);
    };
  }, [container.id]);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [lines]);

  function sendInput(e: React.FormEvent) {
    e.preventDefault();
    if (!connected) return;
    socket.emit("docker:exec:input", input + "\n");
    setInput("");
  }

  if (container.state !== "running") {
    return (
      <div className="rounded-xl border border-border bg-amber-500/5 p-8 text-center space-y-2">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
        <p className="text-sm font-medium">Container is not running</p>
        <p className="text-xs text-muted-foreground">Start the container first to open a terminal session.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* AI Command Assist */}
      {aiConfigured && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 overflow-hidden">
          <div className="px-4 py-2 border-b border-violet-500/20 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-violet-500" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-violet-500/80">AI Command Assist</span>
          </div>
          <form onSubmit={handleAiSuggest} className="flex items-center gap-2 px-3 py-2">
            <input
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              placeholder="Describe what you want to do (e.g. 'list all running processes')…"
              className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
              autoComplete="off"
              disabled={aiLoading}
            />
            <Button type="submit" size="sm" variant="ghost" className="h-7 w-7 p-0 text-violet-500 hover:text-violet-400 hover:bg-violet-500/10 shrink-0" disabled={aiLoading || !aiPrompt.trim()}>
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            </Button>
          </form>
          {aiSuggestion && (
            <div className="border-t border-violet-500/20 px-3 py-2 flex items-center gap-2 bg-[#0d0d0d]">
              <span className="font-mono text-xs text-violet-300 flex-1 break-all">{aiSuggestion}</span>
              <Button
                size="sm"
                className="h-7 text-[10px] gap-1 shrink-0 bg-violet-500/20 border border-violet-500/30 text-violet-300 hover:bg-violet-500/30"
                onClick={useAiSuggestion}
                disabled={!connected}
              >
                <Play className="w-2.5 h-2.5" />Run
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground"
                onClick={() => setAiSuggestion(null)}
              >
                <XCircle className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Terminal Shell */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium">Container Shell</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-muted-foreground"}`} />
            <span className="text-[10px] text-muted-foreground">{connected ? "Connected" : error ? "Error" : "Connecting…"}</span>
          </div>
        </div>
        <div
          ref={outputRef}
          className="h-[440px] overflow-y-auto bg-[#0d0d0d] p-4 font-mono text-[12px] text-green-400 leading-relaxed cursor-text"
          onClick={() => inputRef.current?.focus()}
        >
          {lines.map((line, i) => <div key={i} className="whitespace-pre-wrap break-all">{line}</div>)}
          {!connected && !error && (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Loader2 className="w-3 h-3 animate-spin" />Connecting to container shell…
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
        <div className="px-4 py-2 border-t border-border bg-[#0d0d0d] flex gap-4 text-[10px] text-muted-foreground">
          <span><kbd className="font-mono bg-muted px-1 rounded">Ctrl+C</kbd> interrupt</span>
          <span><kbd className="font-mono bg-muted px-1 rounded">Ctrl+L</kbd> clear</span>
        </div>
      </div>
    </div>
  );
}

// ── Environment Tab ───────────────────────────────────────────────────────────
function EnvironmentTab({ containerName }: { containerName: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useGetContainerEnv(containerName);
  const vars = data?.vars || [];
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState<EnvVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [rollingBack, setRollingBack] = useState<number | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["container-env", containerName] });

  async function handleAdd() {
    if (!newKey.trim()) return;
    setAdding(true);
    try { await containerEnvSet(containerName, newKey.trim(), newValue); setNewKey(""); setNewValue(""); toast.success("Variable saved"); refresh(); }
    catch (err: any) { toast.error(err.message); }
    finally { setAdding(false); }
  }

  async function handleDelete(id: number) {
    try { await containerEnvDelete(containerName, id); toast.success("Variable deleted"); refresh(); }
    catch (err: any) { toast.error(err.message); }
  }

  async function handleApply() {
    setApplying(true);
    try { await containerEnvApply(containerName); toast.success("Container restarted with new environment"); }
    catch (err: any) { toast.error(err.message); }
    finally { setApplying(false); }
  }

  async function openHistory() {
    setShowHistory(true);
    setLoadingVersions(true);
    try { const r = await containerEnvVersions(containerName); setVersions(r.versions); }
    catch (err: any) { toast.error(err.message); }
    finally { setLoadingVersions(false); }
  }

  async function handleRollback(version: number) {
    if (!confirm(`Rollback to version ${version}?`)) return;
    setRollingBack(version);
    try { await containerEnvRollback(containerName, version); toast.success(`Rolled back to v${version} — click Apply to restart.`); setShowHistory(false); refresh(); }
    catch (err: any) { toast.error(err.message); }
    finally { setRollingBack(null); }
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
        {showHistory ? (
          <div className="flex items-center gap-2">
            <button onClick={() => setShowHistory(false)} className="text-muted-foreground hover:text-foreground">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <History className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium">Version History</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium">Environment Variables</span>
          </div>
        )}
        {!showHistory && (
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground" onClick={openHistory}>
            <History className="w-3 h-3" />History
          </Button>
        )}
      </div>

      <div className="p-4 space-y-3">
        {showHistory ? (
          loadingVersions ? (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full bg-muted" />)}</div>
          ) : versions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-xs">No snapshots yet. Apply env vars to create the first version.</div>
          ) : (
            <div className="space-y-2">
              {versions.map(v => (
                <div key={v.id} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-border bg-muted/20">
                  <div className="flex items-center gap-2.5">
                    <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">v{v.version}</Badge>
                    <span className="text-muted-foreground text-xs">{fmtAge(v.applied_at)}</span>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleRollback(v.version)} disabled={rollingBack === v.version}>
                    {rollingBack === v.version ? <RotateCw className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}Rollback
                  </Button>
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Values are encrypted at rest. Click "Apply & Restart" to apply.</p>
            <div className="flex gap-2 items-center">
              <Input placeholder="KEY" value={newKey} onChange={e => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} className="h-8 text-xs font-mono w-40 shrink-0" />
              <span className="text-muted-foreground text-xs shrink-0">=</span>
              <Input placeholder="value" value={newValue} onChange={e => setNewValue(e.target.value)} className="h-8 text-xs font-mono flex-1" />
              <Button size="sm" className="h-8 text-xs shrink-0" onClick={handleAdd} disabled={adding || !newKey.trim()}>
                <Plus className="w-3.5 h-3.5 mr-1" />Add
              </Button>
            </div>
            {isLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-9 w-full bg-muted" />)}</div>
            ) : vars.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-xs">No environment variables set.</div>
            ) : (
              <div className="space-y-1.5">
                {vars.map((v: ContainerEnvVar) => (
                  <div key={v.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/20">
                    <span className="font-mono text-xs font-medium w-40 shrink-0 truncate">{v.key}</span>
                    <span className="text-muted-foreground text-xs">=</span>
                    <div className="flex-1 flex items-center gap-1.5 text-muted-foreground text-xs">
                      <EyeOff className="w-3 h-3 shrink-0" /><span className="font-mono">••••••••</span>
                    </div>
                    <button className="text-muted-foreground hover:text-destructive p-1 rounded" onClick={() => handleDelete(v.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-[11px] text-muted-foreground">{vars.length} variable{vars.length !== 1 ? "s" : ""}</span>
              <Button size="sm" className="h-8 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none"
                onClick={handleApply} disabled={applying || vars.length === 0}>
                {applying ? <><RotateCw className="w-3.5 h-3.5 mr-1 animate-spin" />Applying…</> : <><Save className="w-3.5 h-3.5 mr-1" />Apply & Restart</>}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Schedule Tab ──────────────────────────────────────────────────────────────
const CRON_PRESETS = [
  { label: "Every minute",  value: "* * * * *" },
  { label: "Every 5 min",   value: "*/5 * * * *" },
  { label: "Every 15 min",  value: "*/15 * * * *" },
  { label: "Every hour",    value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Weekly (Mon)", value: "0 0 * * 1" },
  { label: "Custom…",       value: "custom" },
];

function ScheduleTab({ containerName }: { containerName: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useGetContainerSchedules(containerName);
  const schedules = data?.schedules || [];
  const [showAdd, setShowAdd] = useState(false);
  const [label, setLabel] = useState("");
  const [cronPreset, setCronPreset] = useState("* * * * *");
  const [customCron, setCustomCron] = useState("");
  const [command, setCommand] = useState("");
  const [timeoutSecs, setTimeoutSecs] = useState(0);
  const [maxRetries, setMaxRetries] = useState(0);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<number | null>(null);
  const [logEntries, setLogEntries] = useState<ContainerScheduleLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const isCustom = cronPreset === "custom";
  const finalCron = isCustom ? customCron : cronPreset;
  const refresh = () => qc.invalidateQueries({ queryKey: ["container-schedules", containerName] });

  async function handleAdd() {
    if (!label.trim() || !command.trim() || !finalCron) return;
    setSaving(true);
    try {
      await containerScheduleCreate(containerName, { label, cron_expr: finalCron, command, enabled: true, ...(timeoutSecs > 0 ? { timeout_secs: timeoutSecs } : {}), ...(maxRetries > 0 ? { max_retries: maxRetries } : {}) } as any);
      toast.success("Schedule created"); setLabel(""); setCronPreset("* * * * *"); setCustomCron(""); setCommand(""); setTimeoutSecs(0); setMaxRetries(0); setShowAdd(false); refresh();
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  }

  async function handleToggle(s: ContainerSchedule) {
    try { await containerScheduleUpdate(containerName, s.id, { enabled: !s.enabled }); refresh(); }
    catch (err: any) { toast.error(err.message); }
  }

  async function handleDelete(id: number) {
    try { await containerScheduleDelete(containerName, id); toast.success("Schedule deleted"); refresh(); }
    catch (err: any) { toast.error(err.message); }
  }

  async function handleRun(s: ContainerSchedule) {
    setRunningId(s.id);
    try { await containerScheduleRun(containerName, s.id); toast.success("Executed"); refresh(); }
    catch (err: any) { toast.error(err.message); }
    finally { setRunningId(null); }
  }

  async function toggleLogs(s: ContainerSchedule) {
    if (expandedLogs === s.id) { setExpandedLogs(null); return; }
    setExpandedLogs(s.id); setLogsLoading(true);
    try { const { logs } = await containerScheduleLogs(containerName, s.id); setLogEntries(logs); }
    catch { setLogEntries([]); }
    finally { setLogsLoading(false); }
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center gap-2">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-medium">Scheduler</span>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">Run commands inside the container on a cron schedule.</p>
        {showAdd ? (
          <div className="border border-border rounded-xl p-4 space-y-3 bg-muted/20">
            <p className="text-xs font-medium">New Schedule</p>
            <Input placeholder="Label (e.g. Daily cleanup)" value={label} onChange={e => setLabel(e.target.value)} className="h-8 text-xs" />
            <div className="flex gap-2">
              <Select value={cronPreset} onValueChange={setCronPreset}>
                <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>{CRON_PRESETS.map(p => <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>)}</SelectContent>
              </Select>
              {isCustom && <Input placeholder="*/5 * * * *" value={customCron} onChange={e => setCustomCron(e.target.value)} className="h-8 text-xs font-mono flex-1" />}
            </div>
            <Input placeholder="Command to run" value={command} onChange={e => setCommand(e.target.value)} className="h-8 text-xs font-mono" />
            <div className="flex gap-2">
              <div className="flex-1"><label className="text-[10px] text-muted-foreground mb-1 block">Timeout (0 = none)</label>
                <Input type="number" min={0} value={timeoutSecs || ""} onChange={e => setTimeoutSecs(parseInt(e.target.value) || 0)} className="h-8 text-xs" /></div>
              <div className="flex-1"><label className="text-[10px] text-muted-foreground mb-1 block">Max retries</label>
                <Input type="number" min={0} max={5} value={maxRetries || ""} onChange={e => setMaxRetries(Math.min(5, parseInt(e.target.value) || 0))} className="h-8 text-xs" /></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none" onClick={handleAdd} disabled={saving || !label.trim() || !command.trim()}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Schedule"}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="h-8 text-xs w-full border-dashed" onClick={() => setShowAdd(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" />Add Schedule
          </Button>
        )}
        {isLoading ? (
          <div className="space-y-2">{[1,2].map(i => <Skeleton key={i} className="h-16 rounded-xl bg-muted" />)}</div>
        ) : schedules.length === 0 && !showAdd ? (
          <div className="text-center py-10 text-muted-foreground text-xs">No schedules yet.</div>
        ) : (
          <div className="space-y-2">
            {schedules.map(s => (
              <div key={s.id} className="border border-border rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-2.5 bg-background">
                  <button onClick={() => handleToggle(s)} className="shrink-0 text-muted-foreground hover:text-foreground">
                    {s.enabled ? <ToggleRight className="w-5 h-5 text-primary" /> : <ToggleLeft className="w-5 h-5" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{s.label}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{s.cron_expr} · {s.command}</p>
                  </div>
                  <Badge variant="outline" className={`text-[10px] rounded-full px-2 py-0 ${s.enabled ? "text-primary border-primary/30 bg-primary/5" : "text-muted-foreground"}`}>{s.enabled ? "on" : "off"}</Badge>
                  <button onClick={() => handleRun(s)} disabled={runningId === s.id} className="text-muted-foreground hover:text-foreground p-1 rounded" title="Run now">
                    {runningId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => toggleLogs(s)} className="text-muted-foreground hover:text-foreground p-1 rounded">
                    {expandedLogs === s.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => handleDelete(s.id)} className="text-muted-foreground hover:text-destructive p-1 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                {expandedLogs === s.id && (
                  <div className="border-t border-border bg-[#0d0d0d] p-3 max-h-48 overflow-y-auto">
                    {logsLoading ? <div className="flex items-center gap-2 text-muted-foreground text-xs"><Loader2 className="w-3 h-3 animate-spin" />Loading…</div>
                      : logEntries.length === 0 ? <p className="text-xs text-muted-foreground">No runs yet.</p>
                      : <div className="space-y-3">{logEntries.map(log => (
                        <div key={log.id}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${log.status === "success" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>{log.status}</span>
                            <span className="text-[10px] text-muted-foreground">{format(new Date(Number(log.started_at)), "MMM d HH:mm:ss")}</span>
                          </div>
                          <pre className="font-mono text-[10px] text-green-400 whitespace-pre-wrap">{log.output || "(no output)"}</pre>
                        </div>
                      ))}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Domain Tab ────────────────────────────────────────────────────────────────
function DomainTab({ containerName }: { containerName: string }) {
  const qc = useQueryClient();
  const { data: baseData } = useGetBaseDomain();
  const baseCfg = baseData?.config || null;
  const { data: domainsData } = useGetVerifiedDomains();
  const verifiedDomains: VerifiedDomain[] = (domainsData?.domains ?? []).filter((d: VerifiedDomain) => d.verified);

  const [domain, setDomain] = useState<ContainerDomain | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDomainId, setSelectedDomainId] = useState<number | "">("");
  const [savingBase, setSavingBase] = useState(false);
  const [port, setPort] = useState("");
  const [customSub, setCustomSub] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [enablingNginx, setEnablingNginx] = useState(false);
  const [enablingTraefik, setEnablingTraefik] = useState(false);
  const [traefikConfirmOpen, setTraefikConfirmOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [traefikSnippet, setTraefikSnippet] = useState<string | null>(null);
  const [showSnippet, setShowSnippet] = useState(false);
  const [snippetEmail, setSnippetEmail] = useState("");

  useEffect(() => {
    setLoading(true);
    containerDomainGet(containerName).then(r => setDomain(r.domain)).catch(() => {}).finally(() => setLoading(false));
  }, [containerName]);

  useEffect(() => {
    if (baseCfg?.domain && verifiedDomains.length > 0 && selectedDomainId === "") {
      const match = verifiedDomains.find(d => d.domain === baseCfg.domain);
      if (match) setSelectedDomainId(match.id);
    }
  }, [baseCfg, verifiedDomains]);

  const selectedVd = verifiedDomains.find(d => d.id === selectedDomainId) ?? null;
  const baseVerified = !!selectedVd || !!baseCfg?.verified;

  const refresh = () => { qc.invalidateQueries({ queryKey: ["base-domain"] }); containerDomainGet(containerName).then(r => setDomain(r.domain)).catch(() => {}); };

  async function handleSelectDomain(id: number | "") {
    setSelectedDomainId(id);
    if (!id) return;
    const vd = verifiedDomains.find(d => d.id === id);
    if (!vd) return;
    setSavingBase(true);
    try { await baseDomainSave(vd.domain, vd.vps_ip); qc.invalidateQueries({ queryKey: ["base-domain"] }); }
    catch (err: any) { toast.error(err.message); }
    finally { setSavingBase(false); }
  }

  async function handleAssign() {
    if (!port) { toast.error("Port is required"); return; }
    setAssigning(true);
    try { const r = await containerDomainAssign(containerName, parseInt(port), customSub.trim() || undefined) as any; setDomain(r.domain); toast.success("Domain assigned"); }
    catch (err: any) { toast.error(err.message); }
    finally { setAssigning(false); }
  }

  async function handleEnableNginx() {
    setEnablingNginx(true);
    try { await containerDomainNginx(containerName); toast.success("Nginx configured and reloaded"); refresh(); }
    catch (err: any) { toast.error(err.message); }
    finally { setEnablingNginx(false); }
  }

  async function confirmEnableTraefik() {
    setTraefikConfirmOpen(false); setEnablingTraefik(true);
    try { await containerDomainTraefik(containerName); toast.success("Traefik labels applied"); refresh(); }
    catch (err: any) { toast.error(err.message); }
    finally { setEnablingTraefik(false); }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    try { const r = await containerDomainRegenerate(containerName) as any; setDomain(r.domain); toast.success("Domain regenerated"); }
    catch (err: any) { toast.error(err.message); }
    finally { setRegenerating(false); }
  }

  async function handleDelete() {
    try { await containerDomainDelete(containerName); setDomain(null); toast.success("Domain removed"); }
    catch (err: any) { toast.error(err.message); }
  }

  async function loadTraefikSnippet() {
    try { const r = await traefikComposeSnippet(snippetEmail || undefined); setTraefikSnippet(r.snippet); setShowSnippet(true); }
    catch (err: any) { toast.error(err.message); }
  }

  if (loading) return <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground text-xs"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>;

  return (
    <>
      <AlertDialog open={traefikConfirmOpen} onOpenChange={setTraefikConfirmOpen}>
        <AlertDialogContent className="max-w-sm rounded-2xl">
          <AlertDialogHeader><AlertDialogTitle className="text-sm font-semibold">Apply Traefik Labels?</AlertDialogTitle><AlertDialogDescription className="text-xs">This will stop, remove and recreate the container with Traefik labels.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-8 text-xs rounded-lg">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmEnableTraefik} className="h-8 text-xs rounded-lg bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47]">Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="space-y-4">
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Step 1 — Base Domain</span>
            {baseVerified && <Badge className="text-[10px] py-0 px-1.5 rounded-full bg-emerald-500/15 text-emerald-500 border-emerald-500/30 gap-1"><ShieldCheck className="w-3 h-3" />Verified</Badge>}
          </div>
          <div className="p-4 space-y-3">
            {verifiedDomains.length === 0 ? (
              <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                <p className="text-xs text-amber-600 dark:text-amber-400">No verified domains yet.</p>
                <Link href="/domains"><button className="text-xs text-primary hover:underline flex items-center gap-1 ml-3 shrink-0">Go to Domains <ExternalLink className="w-3 h-3" /></button></Link>
              </div>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full h-8 text-xs justify-between font-mono px-3">
                    <span className={selectedDomainId === "" ? "text-muted-foreground" : ""}>{selectedDomainId === "" ? "— Select a domain —" : verifiedDomains.find(d => d.id === selectedDomainId)?.domain}</span>
                    {savingBase ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronDown className="w-3 h-3 opacity-50" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full min-w-[220px] rounded-xl p-1.5">
                  <DropdownMenuItem className="px-2.5 py-2 rounded-lg cursor-pointer text-xs text-muted-foreground" onClick={() => handleSelectDomain("")}>— Select a domain —</DropdownMenuItem>
                  {verifiedDomains.map(d => (
                    <DropdownMenuItem key={d.id} className="px-2.5 py-2 rounded-lg cursor-pointer gap-2.5 text-xs font-mono" onClick={() => handleSelectDomain(d.id)}>
                      <Globe className="w-3.5 h-3.5 text-muted-foreground" />{d.domain}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <div className={`rounded-xl border overflow-hidden transition-opacity ${!baseVerified ? "opacity-50 pointer-events-none" : "border-border"}`}>
          <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Step 2 — Assign Subdomain</span>
          </div>
          <div className="p-4 space-y-3">
            {domain ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-muted/20">
                  <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="font-mono text-xs flex-1 break-all">{domain.full_domain}</span>
                  <button onClick={() => copyToClipboard(`http://${domain.full_domain}`).then(() => toast.success("Copied!"))} className="text-muted-foreground hover:text-foreground p-1"><Copy className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleRegenerate} disabled={regenerating} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                    {regenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}Regenerate
                  </button>
                  <span className="text-muted-foreground text-[11px]">·</span>
                  <button onClick={handleDelete} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" />Remove</button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input placeholder="Port (e.g. 3000)" value={port} onChange={e => setPort(e.target.value)} className="h-8 text-xs w-32 shrink-0" type="number" />
                  <Input placeholder="Subdomain (optional)" value={customSub} onChange={e => setCustomSub(e.target.value)} className="h-8 text-xs flex-1" />
                </div>
                <Button size="sm" className="h-8 text-xs w-full bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none" onClick={handleAssign} disabled={assigning || !port}>
                  {assigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Generate Domain"}
                </Button>
              </div>
            )}
          </div>
        </div>

        {domain && (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Step 3 — Activate Routing</span>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="text-xs font-medium flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-muted-foreground" />Nginx</div>
                  <p className="text-[11px] text-muted-foreground">Write config file and reload nginx.</p>
                  <Button size="sm" variant="outline" className="h-7 text-xs w-full" onClick={handleEnableNginx} disabled={enablingNginx}>
                    {enablingNginx ? <Loader2 className="w-3 h-3 animate-spin" /> : domain.nginx_enabled ? "Re-apply" : "Activate"}
                  </Button>
                </div>
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="text-xs font-medium flex items-center gap-1.5"><Globe className="w-3.5 h-3.5 text-muted-foreground" />Traefik</div>
                  <p className="text-[11px] text-muted-foreground">Recreate container with Traefik labels.</p>
                  <Button size="sm" variant="outline" className="h-7 text-xs w-full" onClick={() => setTraefikConfirmOpen(true)} disabled={enablingTraefik}>
                    {enablingTraefik ? <Loader2 className="w-3 h-3 animate-spin" /> : (domain as any).traefik_enabled ? "Re-apply" : "Activate"}
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border border-border/50 bg-muted/10 overflow-hidden">
                <button className="flex items-center gap-2 w-full px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => showSnippet ? setShowSnippet(false) : loadTraefikSnippet()}>
                  <Code2 className="w-3.5 h-3.5" />Traefik compose snippet{showSnippet ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
                </button>
                {showSnippet && traefikSnippet && (
                  <div className="px-3 pb-3 space-y-2">
                    <div className="flex gap-2 items-center">
                      <Input placeholder="ACME email" value={snippetEmail} onChange={e => setSnippetEmail(e.target.value)} className="h-7 text-xs flex-1" />
                      <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={loadTraefikSnippet}>Refresh</Button>
                    </div>
                    <pre className="bg-muted rounded-lg p-2.5 text-[10px] font-mono overflow-x-auto whitespace-pre">{traefikSnippet}</pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Backup Tab ────────────────────────────────────────────────────────────────
const CRON_BACKUP_PRESETS = [
  { label: "Manual only", value: "manual" },
  { label: "Every hour (0 * * * *)", value: "0 * * * *" },
  { label: "Every 6 hours (0 */6 * * *)", value: "0 */6 * * *" },
  { label: "Daily at midnight (0 0 * * *)", value: "0 0 * * *" },
  { label: "Weekly on Monday (0 0 * * 1)", value: "0 0 * * 1" },
  { label: "Custom…", value: "custom" },
];

function BackupTab({ containerName }: { containerName: string }) {
  const qc = useQueryClient();
  const { data: storageConfigData } = useIsStorageConfigured();
  const storageReady = storageConfigData?.configured === true;
  const { data, isLoading } = useGetContainerBackups(containerName);
  const backups = data?.backups || [];
  const [showAdd, setShowAdd] = useState(false);
  const [label, setLabel] = useState(""); const [bucket, setBucket] = useState(""); const [prefix, setPrefix] = useState(""); const [keepN, setKeepN] = useState("5");
  const [cronPreset, setCronPreset] = useState(""); const [customCron, setCustomCron] = useState(""); const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null); const [expandedTab, setExpandedTab] = useState<"logs" | "restore">("logs");
  const [logs, setLogs] = useState<ContainerBackupLog[]>([]); const [s3Files, setS3Files] = useState<S3BackupFile[]>([]);
  const [logsLoading, setLogsLoading] = useState(false); const [restoring, setRestoring] = useState<string | null>(null); const [selectedS3Key, setSelectedS3Key] = useState("");

  const isCustom = cronPreset === "custom";
  const finalCron = isCustom ? customCron : (cronPreset === "manual" ? "" : cronPreset);
  const refresh = () => qc.invalidateQueries({ queryKey: ["container-backups", containerName] });

  async function handleAdd() {
    if (!label.trim() || !bucket.trim()) return;
    setSaving(true);
    try { await containerBackupCreate(containerName, { label, s3_bucket: bucket, prefix, keep_n: parseInt(keepN) || 5, cron_expr: finalCron || undefined, enabled: true }); toast.success("Backup job created"); setLabel(""); setBucket(""); setPrefix(""); setKeepN("5"); setCronPreset(""); setCustomCron(""); setShowAdd(false); refresh(); }
    catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  }

  async function handleRun(b: ContainerBackup) {
    setRunningId(b.id);
    try { await containerBackupRun(containerName, b.id); toast.success("Backup started"); setTimeout(refresh, 2000); }
    catch (err: any) { toast.error(err.message); }
    finally { setRunningId(null); }
  }

  async function toggleExpand(b: ContainerBackup, tab: "logs" | "restore") {
    if (expandedId === b.id && expandedTab === tab) { setExpandedId(null); return; }
    setExpandedId(b.id); setExpandedTab(tab); setLogsLoading(true);
    try {
      if (tab === "logs") { const { logs: l } = await containerBackupLogs(containerName, b.id); setLogs(l); }
      else { const { files } = await containerBackupS3Files(containerName, b.id); setS3Files(files); }
    } catch { setLogs([]); setS3Files([]); }
    finally { setLogsLoading(false); }
  }

  async function handleRestore(b: ContainerBackup) {
    if (!selectedS3Key) { toast.error("Select a backup file first"); return; }
    setRestoring(selectedS3Key);
    try { await containerRestore(containerName, b.s3_bucket, selectedS3Key); toast.success("Restore started in background"); }
    catch (err: any) { toast.error(err.message); }
    finally { setRestoring(null); }
  }

  if (!storageReady) {
    return (
      <div className="rounded-xl border border-border p-8 text-center space-y-3">
        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
        <p className="text-sm font-medium">S3 Storage not configured</p>
        <p className="text-xs text-muted-foreground">Configure S3 Storage (MinIO) in the Storage page to enable backups.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center gap-2">
        <HardDrive className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-medium">Backups</span>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">Native database dump uploaded directly to S3/MinIO.</p>
        {showAdd ? (
          <div className="border border-border rounded-xl p-4 space-y-3 bg-muted/20">
            <p className="text-xs font-medium">New Backup Job</p>
            <Input placeholder="Label" value={label} onChange={e => setLabel(e.target.value)} className="h-8 text-xs" />
            <div className="flex gap-2">
              <Input placeholder="S3 bucket name" value={bucket} onChange={e => setBucket(e.target.value)} className="h-8 text-xs flex-1" />
              <Input placeholder="Prefix (optional)" value={prefix} onChange={e => setPrefix(e.target.value)} className="h-8 text-xs w-36" />
            </div>
            <div className="flex gap-2 items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-8 text-xs flex-1 justify-between font-normal">
                    <span className={cronPreset ? "text-foreground" : "text-muted-foreground"}>{cronPreset ? (CRON_BACKUP_PRESETS.find(p => p.value === cronPreset)?.label ?? cronPreset) : "Schedule"}</span>
                    <ChevronDown className="w-3 h-3 opacity-50 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-72">
                  {CRON_BACKUP_PRESETS.map(p => <DropdownMenuItem key={p.value} className="text-xs" onClick={() => setCronPreset(p.value)}>{p.label}</DropdownMenuItem>)}
                </DropdownMenuContent>
              </DropdownMenu>
              {isCustom && <Input placeholder="Cron expression" value={customCron} onChange={e => setCustomCron(e.target.value)} className="h-8 text-xs font-mono flex-1" />}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-muted-foreground">Keep</span>
                <Input value={keepN} onChange={e => setKeepN(e.target.value)} className="h-8 text-xs w-14 text-center" type="number" min="1" />
                <span className="text-xs text-muted-foreground">latest</span>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none" onClick={handleAdd} disabled={saving || !label.trim() || !bucket.trim()}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Job"}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="h-8 text-xs w-full border-dashed" onClick={() => setShowAdd(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" />Add Backup Job
          </Button>
        )}
        {isLoading ? (
          <div className="space-y-2">{[1,2].map(i => <Skeleton key={i} className="h-16 rounded-xl bg-muted" />)}</div>
        ) : backups.length === 0 && !showAdd ? (
          <div className="text-center py-10 text-muted-foreground text-xs">No backup jobs yet.</div>
        ) : (
          <div className="space-y-2">
            {backups.map(b => (
              <div key={b.id} className="border border-border rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-2.5 bg-background">
                  <button onClick={() => containerBackupUpdate(containerName, b.id, { enabled: !b.enabled }).then(refresh)} className="shrink-0 text-muted-foreground hover:text-foreground">
                    {b.enabled ? <ToggleRight className="w-5 h-5 text-primary" /> : <ToggleLeft className="w-5 h-5" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{b.label}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{b.s3_bucket} · {b.cron_expr || "manual"} · keep {b.keep_n}</p>
                  </div>
                  <button onClick={() => handleRun(b)} disabled={runningId === b.id} className="text-muted-foreground hover:text-foreground p-1 rounded" title="Run now">
                    {runningId === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => toggleExpand(b, "logs")} className="text-muted-foreground hover:text-foreground p-1 rounded" title="Logs">
                    <Database className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => toggleExpand(b, "restore")} className="text-muted-foreground hover:text-foreground p-1 rounded" title="Restore">
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => containerBackupDelete(containerName, b.id).then(() => { toast.success("Deleted"); refresh(); }).catch((e: any) => toast.error(e.message))} className="text-muted-foreground hover:text-destructive p-1 rounded">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {expandedId === b.id && expandedTab === "logs" && (
                  <div className="border-t border-border bg-[#0d0d0d] p-3 max-h-52 overflow-y-auto">
                    {logsLoading ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Loading…</div>
                      : logs.length === 0 ? <p className="text-xs text-muted-foreground">No runs yet.</p>
                      : <div className="space-y-3">{logs.map(log => (
                        <div key={log.id}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${log.status === "success" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>{log.status}</span>
                            <span className="text-[10px] text-muted-foreground">{format(new Date(Number(log.started_at)), "MMM d HH:mm:ss")}</span>
                          </div>
                          <pre className="font-mono text-[10px] text-green-400 whitespace-pre-wrap">{log.output || "(no output)"}</pre>
                        </div>
                      ))}</div>}
                  </div>
                )}
                {expandedId === b.id && expandedTab === "restore" && (
                  <div className="border-t border-border p-3 space-y-2 bg-muted/10">
                    <p className="text-xs font-medium">Restore from S3</p>
                    {logsLoading ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Loading files…</div>
                      : s3Files.length === 0 ? <p className="text-xs text-muted-foreground">No backups found in S3.</p>
                      : <div className="space-y-1.5">
                        {s3Files.map(f => (
                          <label key={f.key} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer ${selectedS3Key === f.key ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                            <input type="radio" name={`restore-${b.id}`} value={f.key} checked={selectedS3Key === f.key} onChange={() => setSelectedS3Key(f.key || "")} className="sr-only" />
                            <HardDrive className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0"><p className="text-[11px] font-mono truncate">{f.key?.split("/").pop()}</p></div>
                          </label>
                        ))}
                        <Button size="sm" className="h-8 text-xs w-full mt-2 bg-amber-500/10 border border-amber-500/30 text-amber-600 hover:bg-amber-500/20 shadow-none" onClick={() => handleRestore(b)} disabled={!!restoring || !selectedS3Key}>
                          {restoring ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />Restoring…</> : <><RotateCw className="w-3.5 h-3.5 mr-1" />Restore Selected</>}
                        </Button>
                      </div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── AI Tab ────────────────────────────────────────────────────────────────────
type ChatMsg = { role: "user" | "assistant"; content: string };

function AiTab({ container }: { container: DockerContainer }) {
  const { data: aiSettings, isLoading: loadingSettings } = useGetAiSettings();
  const configured = aiSettings?.configured ?? false;

  const containerName = (container.names[0] || container.shortId).replace(/^\//, "");

  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const SYSTEM_CTX =
    `You are a Docker and DevOps expert assistant integrated into Docklet. ` +
    `The user is asking about the container: name="${containerName}", image="${container.image}", state="${container.state}". ` +
    `Answer concisely and practically. Use markdown for code blocks when helpful.`;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatLoading]);

  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const logs = await dockerLogs(container.id, 200).then(r => r.logs).catch(() => "(logs unavailable)");
      const result = await aiAnalyzeLogs({
        logs,
        containerName,
        containerState: container.state,
        containerImage: container.image,
      });
      setAnalysis(result);
    } catch (err: any) {
      toast.error(err.message || "AI analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleChat(e: React.FormEvent) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    const newMsgs: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(newMsgs);
    setChatInput("");
    setChatLoading(true);
    try {
      const r = await aiChat(newMsgs.map(m => ({ role: m.role, content: m.content })), SYSTEM_CTX);
      setMessages(prev => [...prev, { role: "assistant", content: r.content }]);
    } catch (err: any) {
      toast.error(err.message || "AI request failed");
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally {
      setChatLoading(false);
    }
  }

  if (loadingSettings) {
    return <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground text-xs"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>;
  }

  if (!configured) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto">
          <Sparkles className="w-7 h-7 text-violet-500" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">AI Not Configured</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
            Set up your NVIDIA API key on the AI page to enable log analysis and container chat.
          </p>
        </div>
        <Link href="/ai">
          <Button size="sm" className="h-8 gap-2">
            <Sparkles className="w-3.5 h-3.5" />Set Up AI
          </Button>
        </Link>
      </div>
    );
  }

  const healthColors: Record<string, string> = {
    healthy: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    error: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    unknown: "bg-muted text-muted-foreground border-border",
  };
  const healthLabel: Record<string, string> = { healthy: "✓ Healthy", error: "✗ Error", warning: "⚠ Warning", unknown: "? Unknown" };

  return (
    <div className="space-y-5">
      {/* Analyze panel */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Log Analysis</span>
            {analysis && (
              <Badge className={`text-[10px] rounded-full px-2 py-0 ${healthColors[analysis.health] || healthColors.unknown}`}>
                {healthLabel[analysis.health] || analysis.health}
              </Badge>
            )}
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleAnalyze} disabled={analyzing}>
            {analyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 text-violet-500" />}
            {analyzing ? "Analyzing…" : analysis ? "Re-analyze" : "Analyze Container"}
          </Button>
        </div>

        {!analysis && !analyzing && (
          <div className="p-6 text-center space-y-2">
            <Bot className="w-8 h-8 text-muted-foreground/30 mx-auto" />
            <p className="text-xs text-muted-foreground">Click "Analyze Container" to let AI inspect the logs and give you a health report.</p>
            <p className="text-[11px] text-muted-foreground/60">AI will check for errors, crashes, warnings, and provide recommendations.</p>
          </div>
        )}

        {analyzing && (
          <div className="p-6 flex flex-col items-center gap-3">
            <Loader2 className="w-7 h-7 animate-spin text-violet-500" />
            <p className="text-xs text-muted-foreground">Fetching logs and analyzing with AI…</p>
          </div>
        )}

        {analysis && !analyzing && (
          <div className="p-4 space-y-4">
            <p className="text-sm leading-relaxed">{analysis.summary}</p>

            {analysis.crashReason && (
              <div className="flex gap-3 bg-red-500/5 border border-red-500/20 rounded-xl p-3">
                <TriangleAlert className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide mb-1">Crash Reason</p>
                  <p className="text-xs text-red-600 dark:text-red-400">{analysis.crashReason}</p>
                </div>
              </div>
            )}

            {analysis.logHighlights?.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="px-3 py-2 bg-muted/40 border-b border-border">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Key Log Lines</span>
                </div>
                <div className="bg-[#0d0d0d] p-3 space-y-1">
                  {analysis.logHighlights.map((line, i) => (
                    <div key={i} className="font-mono text-[11px] text-amber-400 whitespace-pre-wrap break-all">{line}</div>
                  ))}
                </div>
              </div>
            )}

            {analysis.issues?.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Issues Found</p>
                {analysis.issues.map((issue, i) => (
                  <div key={i} className="flex gap-2 items-start text-xs">
                    <span className="text-amber-500 shrink-0 mt-0.5">•</span>
                    <span>{issue}</span>
                  </div>
                ))}
              </div>
            )}

            {analysis.recommendations?.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Recommendations</p>
                {analysis.recommendations.map((rec, i) => (
                  <div key={i} className="flex gap-2 items-start text-xs">
                    <Lightbulb className="w-3.5 h-3.5 text-violet-500 shrink-0 mt-0.5" />
                    <span>{rec}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chat panel */}
      <div className="rounded-xl border border-border overflow-hidden flex flex-col" style={{ minHeight: "420px" }}>
        <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-violet-500" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Container Chat</span>
            <Badge className="text-[10px] bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20 rounded-full px-2 py-0">
              {aiSettings?.model?.split("/").pop() || "AI"}
            </Badge>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground gap-1" onClick={() => setMessages([])}>
              <RotateCcw className="w-3 h-3" />Clear
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ maxHeight: "380px" }}>
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-8">
              <Bot className="w-8 h-8 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">Ask anything about <strong>{containerName}</strong>.</p>
              <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                {[
                  `Why is ${containerName} restarting?`,
                  "How do I check memory usage?",
                  "What logs should I look for?",
                  "How do I connect to this container's shell?",
                ].map(q => (
                  <button key={q} onClick={() => setChatInput(q)}
                    className="text-[11px] bg-muted hover:bg-muted/80 border border-border px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors text-left">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center border ${
                msg.role === "user"
                  ? "bg-primary/10 border-primary/20 text-primary"
                  : "bg-violet-500/10 border-violet-500/20 text-violet-500"
              }`}>
                {msg.role === "user" ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
              </div>
              <div className={`flex-1 max-w-[85%] rounded-xl px-3.5 py-2.5 ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground ml-auto"
                  : "bg-muted/50 border border-border"
              }`}>
                {msg.role === "user"
                  ? <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
                  : <MarkdownContent content={msg.content} />
                }
              </div>
            </div>
          ))}

          {chatLoading && (
            <div className="flex gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center border bg-violet-500/10 border-violet-500/20 text-violet-500">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="bg-muted/50 border border-border rounded-xl px-3.5 py-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
                <span className="text-xs text-muted-foreground">Thinking…</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleChat} className="border-t border-border bg-background flex items-center gap-2 p-3">
          <Input
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            placeholder={`Ask about ${containerName}…`}
            className="h-9 text-sm flex-1"
            disabled={chatLoading}
            autoComplete="off"
          />
          <Button type="submit" size="sm" className="h-9 w-9 p-0 shrink-0" disabled={!chatInput.trim() || chatLoading}>
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
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
      <path d="M22 8.5C21.5 7 20 6.5 18.5 6.5C18 4.5 16.5 3.5 14.5 3.5V6.5H16V9.5H1C1 12 2.5 14 5 14.5C7.5 15 21 15 22 13C23 11 22.5 10 22 8.5Z" fill="currentColor" opacity="0.3"/>
    </svg>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ContainerDetailPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("action");

  const { data: containersData, isLoading } = useGetDockerContainers();
  const container = containersData?.containers?.find(
    (c: DockerContainer) => c.id === params.id || c.shortId === params.id
  );

  const containerName = container
    ? (container.names[0] || container.shortId).replace(/^\//, "")
    : "";

  function refresh() {
    qc.invalidateQueries({ queryKey: ["docker-containers"] });
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex">
        <DesktopSidebar />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!container) {
    return (
      <div className="min-h-screen bg-background text-foreground flex">
        <DesktopSidebar />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
          <Container className="w-12 h-12 text-muted-foreground" />
          <h2 className="text-lg font-medium">Container not found</h2>
          <p className="text-sm text-muted-foreground">The container with ID <code className="font-mono">{params.id}</code> was not found.</p>
          <Button variant="outline" size="sm" onClick={() => navigate("/docker")}>
            <ArrowLeft className="w-4 h-4 mr-2" />Back to Docker Manager
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <DesktopSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="px-4 h-14 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <MobileSidebarTrigger />
              <button onClick={() => navigate("/docker")} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm">
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Docker Manager</span>
              </button>
              <span className="text-muted-foreground">/</span>
              <div className="flex items-center gap-2">
                <DockerLogo className="w-5 h-4 text-[#2496ed]" />
                <span className="font-medium text-sm tracking-tight">{containerName}</span>
              </div>
              <Badge variant="outline" className={`font-mono text-[10px] uppercase rounded-full px-2 py-0 ${container.state === "running" ? "text-primary bg-primary/10 border-primary/20" : "text-muted-foreground bg-muted/50"}`}>
                {container.state}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground" onClick={toggle}>
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
              <Button variant="outline" size="sm" className="h-8 rounded-full text-xs" onClick={refresh}>
                <RefreshCw className="w-3.5 h-3.5 mr-2" />Refresh
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="px-4 border-t border-border/60 flex overflow-x-auto scrollbar-none">
            {TABS.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 px-4 py-6 max-w-4xl w-full mx-auto pb-24">
          {activeTab === "action" && <ActionTab container={container} onRefresh={refresh} />}
          {activeTab === "terminal" && <TerminalTab container={container} />}
          {activeTab === "environment" && <EnvironmentTab containerName={containerName} />}
          {activeTab === "schedule" && <ScheduleTab containerName={containerName} />}
          {activeTab === "domain" && <DomainTab containerName={containerName} />}
          {activeTab === "backup" && <BackupTab containerName={containerName} />}
          {activeTab === "ai" && <AiTab container={container} />}
        </main>
      </div>
    </div>
  );
}
