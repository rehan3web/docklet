import React, { useEffect, useRef, useState, useMemo } from "react";
import { Terminal as TerminalIcon, Sparkles, Settings, AlertTriangle, Loader2, Trash2, Sun, Moon, Zap, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import {
  useGetCommandSuggestions,
  useGetTerminalSettings,
  saveTerminalSettings,
  deleteTerminalSettings,
  generateAiCommand,
  execCommand,
  clearTerminalHistory,
  generateClientCommandId,
  getTerminalCwd,
} from "@/api/client";
import { getSocket } from "@/api/socket";
import { useQueryClient } from "@tanstack/react-query";

type LogLine = { stream: "stdout" | "stderr" | "system" | "input"; text: string };

export default function TerminalPage() {
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const { data: suggestionsData } = useGetCommandSuggestions();
  const { data: settings, refetch: refetchSettings } = useGetTerminalSettings();

  const [command, setCommand] = useState("");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const activeIdRef = useRef<string | null>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const [termFocused, setTermFocused] = useState(false);

  // Autocomplete
  const [acIndex, setAcIndex] = useState(0);
  const [acVisible, setAcVisible] = useState(false);

  // Dangerous command confirm
  const [pendingExec, setPendingExec] = useState<string | null>(null);
  const [confirmReason, setConfirmReason] = useState("");
  const [confirmInput, setConfirmInput] = useState("");

  // AI Generate
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiGenerated, setAiGenerated] = useState<{ command: string; safe: boolean; reason?: string } | null>(null);

  // Auto Run
  const [autoRun, setAutoRun] = useState(() => {
    try { return localStorage.getItem("terminal-autorun") === "true"; } catch { return false; }
  });
  const [autoRunPending, setAutoRunPending] = useState<{ command: string; safe: boolean; reason?: string } | null>(null);

  function toggleAutoRun() {
    setAutoRun(v => {
      const next = !v;
      try { localStorage.setItem("terminal-autorun", String(next)); } catch {}
      return next;
    });
  }

  // Persistent working directory (updated after every command)
  const [cwd, setCwd] = useState("/usr/src/app");

  // Fetch initial cwd from backend on mount
  useEffect(() => {
    getTerminalCwd().then(r => setCwd(r.sandboxCwd)).catch(() => {});
  }, []);

  // Settings dialog
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsKey, setSettingsKey] = useState("");
  const [settingsModel, setSettingsModel] = useState("");

  // Auto-scroll
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [logs, command]);

  // WebSocket
  useEffect(() => {
    const socket = getSocket();
    const onStart = (e: { id: string; command: string }) => {
      if (e.id !== activeIdRef.current) return;
      setLogs(prev => [...prev, { stream: "input", text: `$ ${e.command}` }]);
    };
    const onOutput = (e: { id: string; chunk: string; stream: "stdout" | "stderr" }) => {
      if (e.id !== activeIdRef.current) return;
      setLogs(prev => [...prev, { stream: e.stream, text: e.chunk }]);
    };
    const onEnd = (e: { id: string; exitCode: number; durationMs: number; cwd?: string }) => {
      if (e.id !== activeIdRef.current) return;
      setLogs(prev => [...prev, { stream: "system", text: `[exit ${e.exitCode} · ${e.durationMs}ms]` }]);
      if (e.cwd) setCwd(e.cwd);
      setRunning(false);
      activeIdRef.current = null;
    };
    socket.on("terminal-start", onStart);
    socket.on("terminal-output", onOutput);
    socket.on("terminal-end", onEnd);
    return () => {
      socket.off("terminal-start", onStart);
      socket.off("terminal-output", onOutput);
      socket.off("terminal-end", onEnd);
    };
  }, []);

  // Filtered autocomplete suggestions based on current input
  const allSuggestions = suggestionsData?.suggestions || [];
  const acMatches = useMemo(() => {
    const q = command.trim().toLowerCase();
    if (!q) return [];
    return allSuggestions.filter(s =>
      s.cmd.toLowerCase().startsWith(q) ||
      s.cmd.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [command, allSuggestions]);

  // Show/hide autocomplete
  useEffect(() => {
    setAcVisible(acMatches.length > 0 && termFocused && command.trim().length > 0);
    setAcIndex(0);
  }, [acMatches.length, command, termFocused]);

  async function runCommand(cmd: string, confirm?: string) {
    if (!cmd.trim()) return;
    setAcVisible(false);
    setRunning(true);
    const clientId = generateClientCommandId();
    activeIdRef.current = clientId;
    try {
      const r = await execCommand(cmd, confirm, clientId, false);
      if (r.requiresConfirmation) {
        setPendingExec(cmd);
        setConfirmReason(r.reason || "Dangerous command detected");
        activeIdRef.current = null;
        setRunning(false);
      }
    } catch (err: any) {
      setLogs(prev => [...prev, { stream: "stderr", text: `[error: ${err.message}]` }]);
      activeIdRef.current = null;
      setRunning(false);
    }
  }

  function handleTerminalKey(e: React.KeyboardEvent<HTMLInputElement>) {
    // Autocomplete navigation
    if (acVisible && acMatches.length > 0) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAcIndex(i => (i - 1 + acMatches.length) % acMatches.length);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAcIndex(i => (i + 1) % acMatches.length);
        return;
      }
      if (e.key === "Tab" || e.key === "ArrowRight") {
        e.preventDefault();
        setCommand(acMatches[acIndex].cmd);
        setAcVisible(false);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const selected = acMatches[acIndex].cmd;
        setCommand("");
        setAcVisible(false);
        runCommand(selected);
        return;
      }
      if (e.key === "Escape") {
        setAcVisible(false);
        return;
      }
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const cmd = command.trim();
      if (!cmd || running) return;
      setCommand("");
      runCommand(cmd);
    }
  }

  function focusTerminal() {
    hiddenInputRef.current?.focus();
    setTermFocused(true);
  }

  async function handleConfirmedRun() {
    if (!pendingExec) return;
    const cmd = pendingExec;
    setPendingExec(null);
    setConfirmInput("");
    await runCommand(cmd, "I CONFIRM");
  }

  async function handleAiGenerate() {
    if (!aiPrompt.trim() || !settings?.configured) return;
    setAiLoading(true);
    setAiGenerated(null);
    setAutoRunPending(null);
    try {
      const r = await generateAiCommand(aiPrompt.trim());
      if (autoRun) {
        setAutoRunPending(r);
      } else {
        setAiGenerated(r);
      }
    } catch (err: any) {
      toast.error(err.message || "AI request failed");
    } finally {
      setAiLoading(false);
    }
  }

  function insertGenerated() {
    if (!aiGenerated) return;
    setCommand(aiGenerated.command);
    setAiGenerated(null);
    setAiPrompt("");
    focusTerminal();
  }

  async function handleSaveSettings() {
    try {
      await saveTerminalSettings(settingsKey, settingsModel || undefined);
      toast.success("NVIDIA API key saved");
      setSettingsOpen(false);
      setSettingsKey("");
      setSettingsModel("");
      refetchSettings();
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    }
  }

  async function handleClearKey() {
    await deleteTerminalSettings();
    toast.success("NVIDIA API key removed");
    refetchSettings();
  }

  async function handleClearHistory() {
    await clearTerminalHistory();
    setLogs([]);
    qc.invalidateQueries({ queryKey: ["terminal-history"] });
  }

  return (
    <div className="h-screen bg-background text-foreground flex overflow-hidden">
      <DesktopSidebar />
      <div className="flex-1 flex flex-col min-w-0 h-screen">

        {/* Header */}
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MobileSidebarTrigger />
              <div className="hidden lg:flex items-center gap-3">
                <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0">
                  <TerminalIcon className="w-4 h-4 text-primary" />
                </div>
                <span className="font-medium text-sm tracking-tight text-foreground">AI Terminal</span>
                <Badge variant="outline" className={`text-[10px] font-mono uppercase rounded-full px-2 py-0 h-4 ${
                  settings?.configured
                    ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20"
                    : "text-muted-foreground/60 bg-muted/30 border-border"
                }`}>
                  {settings?.configured ? "AI Ready" : "AI Off"}
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-8 rounded-full text-xs text-muted-foreground gap-1.5 px-3 hover:bg-muted/60" onClick={() => setSettingsOpen(true)}>
                <Settings className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Settings</span>
              </Button>
              <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" onClick={toggle} aria-label="Toggle theme">
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 flex flex-col overflow-hidden">

          {/* ── Terminal Window ─────────────────────────────────────── */}
          <div
            className="flex-1 overflow-hidden border-b flex flex-col cursor-text border-[#e0e0e0] dark:border-[#252525] bg-[#f8f8f8] dark:bg-[#0d0d0d]"
            onClick={focusTerminal}
          >
            {/* Title bar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0 bg-[#efefef] dark:bg-[#181818] border-[#e0e0e0] dark:border-[#252525]">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#ff5f57] border border-[#e0443e]" />
                <span className="w-3 h-3 rounded-full bg-[#febc2e] border border-[#d4a012]" />
                <span className="w-3 h-3 rounded-full bg-[#28c840] border border-[#14ae2c]" />
              </div>
              <div className="flex items-center gap-1.5">
                <TerminalIcon className="w-3 h-3 text-[#aaa] dark:text-[#555]" />
                <span className="text-[11px] font-mono select-none text-[#aaa] dark:text-[#555]">
                  docklet — bash
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost" size="sm"
                  className="h-6 px-2 text-[10px] text-[#aaa] dark:text-[#555] hover:text-[#555] dark:hover:text-[#999] hover:bg-[#e0e0e0] dark:hover:bg-[#222] rounded gap-1"
                  onClick={e => { e.stopPropagation(); handleClearHistory(); }}
                >
                  <Trash2 className="w-3 h-3" /> Clear
                </Button>
              </div>
            </div>

            {/* Output area */}
            <div
              ref={outputRef}
              className="flex-1 overflow-y-auto p-4 font-mono text-[13px] leading-[1.6] select-text"
            >
              {logs.length === 0 && (
                <div className="mb-3 space-y-0.5">
                  <div className="text-[#ccc] dark:text-[#3a3a3a] text-[11px] select-none">────────────────────────────────────</div>
                  <div className="text-[#16a34a]/80 dark:text-[#4ade80]/70">Docklet AI Terminal v1.0</div>
                  <div className="text-[#888] dark:text-[#444]">Connected · type a command or generate one with AI below</div>
                  <div className="text-[#ccc] dark:text-[#3a3a3a] text-[11px] select-none mt-1">────────────────────────────────────</div>
                </div>
              )}
              {logs.map((line, i) => (
                <div key={i} className={
                  line.stream === "input"  ? "text-[#0369a1] dark:text-[#67e8f9] font-semibold" :
                  line.stream === "stderr" ? "text-[#dc2626] dark:text-[#f87171]" :
                  line.stream === "system" ? "text-[#999] dark:text-[#555] text-[11px]" :
                  "text-[#166534] dark:text-[#86efac]"
                }>
                  {line.text}
                </div>
              ))}
              {running && (
                <div className="flex items-center gap-1.5 text-[#aaa] dark:text-[#444] text-[11px] mt-0.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#16a34a] dark:bg-[#4ade80] animate-pulse" />
                  executing…
                </div>
              )}

              {/* Inline input line */}
              {!running && (
                <div className="relative">
                  {/* Autocomplete dropdown */}
                  {acVisible && acMatches.length > 0 && (
                    <div className="absolute bottom-full left-0 mb-1 w-72 rounded-lg border border-[#e0e0e0] dark:border-[#2a2a2a] bg-white dark:bg-[#111] shadow-xl overflow-hidden z-50">
                      <div className="px-3 py-1.5 border-b border-[#ececec] dark:border-[#1f1f1f] flex items-center justify-between">
                        <span className="text-[10px] text-[#999] dark:text-[#555] uppercase tracking-wider font-medium">Suggestions</span>
                        <span className="text-[10px] text-[#bbb] dark:text-[#444]">↑↓ navigate · Tab select · Esc close</span>
                      </div>
                      {acMatches.map((s, i) => (
                        <button
                          key={s.cmd}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                            i === acIndex ? "bg-[#f0f0f0] dark:bg-[#1a1a1a]" : "hover:bg-[#f8f8f8] dark:hover:bg-[#161616]"
                          }`}
                          onMouseDown={e => {
                            e.preventDefault();
                            setCommand(s.cmd);
                            setAcVisible(false);
                            focusTerminal();
                          }}
                          onMouseEnter={() => setAcIndex(i)}
                        >
                          <code className={`font-mono text-[12px] w-20 shrink-0 ${i === acIndex ? "text-primary" : "text-[#166534] dark:text-[#86efac]"}`}>
                            {s.cmd}
                          </code>
                          <span className="text-[11px] text-[#999] dark:text-[#555] truncate">{s.desc}</span>
                          {i === acIndex && (
                            <span className="ml-auto shrink-0 text-[10px] text-[#ccc] dark:text-[#333] font-mono">Tab</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* $ prompt line */}
                  <div className="flex items-center gap-0 mt-0.5" onClick={e => e.stopPropagation()}>
                    <span className="mr-2 select-none font-mono text-xs text-[#aaa] dark:text-[#555]">
                      {cwd.replace(/^\/root(\/|$)/, "~$1").replace(/^\/home\/[^/]+/, "~")}
                    </span>
                    <span className="mr-2 select-none font-bold text-[#bbb] dark:text-[#555]">$</span>
                    <span className="text-[#111] dark:text-[#e5e5e5] whitespace-pre">{command}</span>
                    <span
                      className={`inline-block w-[8px] h-[14px] bg-[#333] dark:bg-[#e5e5e5] ml-px align-middle ${
                        termFocused ? "animate-[blink_1s_step-end_infinite]" : "opacity-20"
                      }`}
                      style={{ verticalAlign: "middle", marginTop: 1 }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Hidden real input */}
            <input
              ref={hiddenInputRef}
              value={command}
              onChange={e => { if (!running) setCommand(e.target.value); }}
              onKeyDown={handleTerminalKey}
              onFocus={() => setTermFocused(true)}
              onBlur={() => { setTermFocused(false); setTimeout(() => setAcVisible(false), 150); }}
              className="sr-only"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label="Terminal input"
            />
          </div>

          {/* ── AI Generate Command ─────────────────────────────────── */}
          <div className="shrink-0 border-t border-border bg-background overflow-hidden">
            <div className="flex items-center justify-between gap-2.5 px-4 py-3 border-b border-border/50">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 rounded-md bg-primary/10 border border-primary/20 shrink-0">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-none">AI Assistant</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Describe a task — NVIDIA LLM will produce a shell command</p>
                </div>
              </div>
              {/* Auto Run toggle */}
              <button
                onClick={toggleAutoRun}
                title={autoRun ? "Auto Run is ON — generated commands run automatically after confirmation" : "Auto Run is OFF — generated commands are inserted for manual review"}
                className={`shrink-0 flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                  autoRun
                    ? "bg-red-500/10 border-red-500/30 text-red-500 dark:text-red-400"
                    : "bg-muted/40 border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                <Zap className={`w-3 h-3 ${autoRun ? "fill-red-500 dark:fill-red-400" : ""}`} />
                Auto Run {autoRun ? "ON" : "OFF"}
              </button>
            </div>
            <div className="p-4 space-y-3">
              {!settings?.configured && (
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    NVIDIA API key not configured.{" "}
                    <button className="underline underline-offset-2 font-medium" onClick={() => setSettingsOpen(true)}>
                      Open Terminal Settings
                    </button>{" "}
                    to add one.
                  </span>
                </div>
              )}
              {/* Textarea with embedded send button */}
              <div className="relative">
                <Textarea
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  placeholder="e.g. show me the 5 largest files in the current directory"
                  className="text-xs min-h-[88px] resize-none font-mono placeholder:text-muted-foreground/40 pr-12 pb-10"
                  disabled={!settings?.configured || aiLoading}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleAiGenerate();
                    }
                  }}
                />
                <button
                  onClick={handleAiGenerate}
                  disabled={!settings?.configured || aiLoading || !aiPrompt.trim()}
                  className={`absolute bottom-2.5 right-2.5 w-7 h-7 flex items-center justify-center rounded-md transition-all
                    border border-black/10 dark:border-white/10 shadow-none
                    ${(!settings?.configured || !aiPrompt.trim())
                      ? "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
                      : "bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] cursor-pointer"
                    }`}
                >
                  {aiLoading
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <SendHorizontal className="w-3.5 h-3.5" />
                  }
                </button>
                <span className="absolute bottom-2.5 left-3 text-[10px] text-muted-foreground/50 select-none pointer-events-none">
                  Enter to send · Shift+Enter for new line
                </span>
              </div>
              {aiGenerated && (
                <div className="rounded-lg border border-[#e0e0e0] dark:border-[#252525] bg-[#f5f5f5] dark:bg-[#0d0d0d] overflow-hidden">
                  {!aiGenerated.safe && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-900/20 text-[11px] text-red-500 dark:text-red-400">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>{aiGenerated.reason}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <code className="font-mono text-[12px] text-[#166534] dark:text-[#86efac] flex-1 truncate">{aiGenerated.command}</code>
                    <Button size="sm" className="h-7 px-3 text-[11px] shrink-0 rounded-md border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none" onClick={insertGenerated}>
                      Insert into Terminal
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* ── Dangerous Command Confirmation ── */}
      <Dialog open={!!pendingExec} onOpenChange={o => { if (!o) { setPendingExec(null); setConfirmInput(""); } }}>
        <DialogContent className="sm:max-w-[420px] border-destructive/30">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-destructive">
              <div className="p-1.5 rounded-md bg-destructive/10 border border-destructive/20">
                <AlertTriangle className="w-4 h-4" />
              </div>
              Dangerous Command
            </DialogTitle>
            <DialogDescription className="pt-1">{confirmReason}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="rounded-lg bg-[#f5f5f5] dark:bg-[#0d0d0d] border border-[#e0e0e0] dark:border-[#252525] px-4 py-3">
              <code className="font-mono text-[12px] text-red-500 dark:text-red-400 break-all leading-relaxed">{pendingExec}</code>
            </div>
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Type <kbd className="font-mono font-bold text-foreground bg-muted px-1.5 py-0.5 rounded text-[11px]">I CONFIRM</kbd> to allow execution.
              </p>
              <Input
                value={confirmInput}
                onChange={e => setConfirmInput(e.target.value)}
                placeholder="I CONFIRM"
                className="font-mono text-sm border-destructive/30 focus-visible:ring-destructive/30"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter" && confirmInput === "I CONFIRM") handleConfirmedRun(); }}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => { setPendingExec(null); setConfirmInput(""); }}>Cancel</Button>
            <Button variant="destructive" disabled={confirmInput !== "I CONFIRM"} onClick={handleConfirmedRun}>
              Execute Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Auto Run Confirmation ── */}
      <Dialog open={!!autoRunPending} onOpenChange={o => { if (!o) setAutoRunPending(null); }}>
        <DialogContent className="sm:max-w-[440px] border-destructive/30">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-destructive">
              <div className="p-1.5 rounded-md bg-destructive/10 border border-destructive/20 shrink-0">
                <Zap className="w-4 h-4" />
              </div>
              Auto-Run Confirmation
            </DialogTitle>
            <DialogDescription className="pt-1">
              Auto-Run is <strong>ON</strong>. The command below will execute immediately once you confirm.
              {autoRunPending && !autoRunPending.safe && " This command has also been flagged as potentially dangerous."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {autoRunPending && !autoRunPending.safe && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/20 text-[11px] text-red-500 dark:text-red-400">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{autoRunPending.reason}</span>
              </div>
            )}
            <div className="rounded-lg bg-[#f5f5f5] dark:bg-[#0d0d0d] border border-[#e0e0e0] dark:border-[#252525] px-4 py-3">
              <code className="font-mono text-[12px] text-[#166534] dark:text-[#86efac] break-all leading-relaxed">
                {autoRunPending?.command}
              </code>
            </div>
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 text-[11px] text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>This command will run directly in your server container. Review it carefully before confirming.</span>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setAutoRunPending(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                const cmd = autoRunPending!.command;
                setAutoRunPending(null);
                setAiPrompt("");
                runCommand(cmd);
              }}
            >
              <Zap className="w-3.5 h-3.5 mr-1.5" /> Run Command
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Terminal Settings ── */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-muted-foreground" />
              Terminal Settings
            </DialogTitle>
            <DialogDescription>Configure the NVIDIA LLM API for AI command generation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {settings?.configured && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Model</span>
                  <span className="font-mono">{settings.model}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">API Key</span>
                  <span className="font-mono">{settings.apiKeyMasked}</span>
                </div>
                <Button variant="outline" size="sm" className="w-full h-8 text-xs mt-1 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/5" onClick={handleClearKey}>
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove Key
                </Button>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-medium">NVIDIA API Key</label>
              <Input type="password" value={settingsKey} onChange={e => setSettingsKey(e.target.value)} placeholder="nvapi-…" className="font-mono text-xs" />
              <p className="text-[10px] text-muted-foreground">Get your key from <a className="underline underline-offset-2" href="https://build.nvidia.com/" target="_blank" rel="noreferrer">build.nvidia.com</a>.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Model <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input value={settingsModel} onChange={e => setSettingsModel(e.target.value)} placeholder="openai/gpt-oss-120b" className="font-mono text-xs" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button className="border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none" onClick={handleSaveSettings} disabled={!settingsKey.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
