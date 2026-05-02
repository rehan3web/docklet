import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Sparkles, Key, Cpu, CheckCircle, XCircle, Loader2, Trash2, Send, Bot,
  User, RotateCcw, ExternalLink, ChevronDown, ChevronUp, Terminal,
  MessageSquare, Play, AlertTriangle, Package, Zap, Database, Globe,
  Server, Container, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import {
  useGetAiSettings, saveAiSettings, deleteAiSettings,
  aiChat, agentRun, agentInstallDocker, getToken,
} from "@/api/client";
import { useQueryClient } from "@tanstack/react-query";
import { Sun, Moon } from "lucide-react";
import { io as socketIo } from "socket.io-client";
import { cn } from "@/lib/utils";

const NVIDIA_MODELS = [
  { value: "openai/gpt-oss-120b",                label: "GPT-OSS 120B (Default)" },
  { value: "meta/llama-3.3-70b-instruct",         label: "Llama 3.3 70B Instruct" },
  { value: "meta/llama-3.1-405b-instruct",        label: "Llama 3.1 405B Instruct" },
  { value: "mistralai/mistral-large-2-instruct",  label: "Mistral Large 2" },
  { value: "nvidia/nemotron-4-340b-instruct",     label: "Nemotron 4 340B" },
  { value: "google/gemma-3-27b-it",              label: "Gemma 3 27B IT" },
];

type ChatMsg = { role: "user" | "assistant"; content: string };
type AgentLogType = "thinking" | "ai" | "command" | "output" | "success" | "error" | "info" | "docker_missing";
type AgentLog  = { id: string; type: AgentLogType; content: string; timestamp: number };
type AgentTask = { agentId: string; userMessage: string; logs: AgentLog[]; done: boolean; success?: boolean; summary?: string; dockerMissing?: boolean };

const CHAT_SYSTEM =
  "You are a helpful Docker, DevOps, and infrastructure assistant inside Docklet — a VPS/Docker/PostgreSQL management dashboard. " +
  "Help with container management, networking, debugging, SQL, shell commands, and infrastructure questions. " +
  "Be concise, practical, and give actionable answers. Use markdown for code blocks.";

const AGENT_PROMPTS = [
  { icon: <Package className="w-4 h-4" />,   label: "Install Redis",      prompt: "Install Redis" },
  { icon: <Database className="w-4 h-4" />,  label: "Install PostgreSQL", prompt: "Install PostgreSQL with a default password of 'postgres'" },
  { icon: <Globe className="w-4 h-4" />,     label: "Install Nginx",      prompt: "Install Nginx web server" },
  { icon: <Container className="w-4 h-4" />, label: "Install MongoDB",    prompt: "Install MongoDB" },
  { icon: <Server className="w-4 h-4" />,    label: "Install MySQL",      prompt: "Install MySQL with root password 'root'" },
  { icon: <Download className="w-4 h-4" />,  label: "Install RabbitMQ",   prompt: "Install RabbitMQ message broker" },
];

const CHAT_PROMPTS = [
  "Why would a container keep restarting?",
  "How do I check PostgreSQL slow queries?",
  "What does OOMKilled mean?",
  "How to limit container memory?",
];

let socketRef: ReturnType<typeof socketIo> | null = null;
function getOrCreateSocket() {
  if (!socketRef) {
    socketRef = socketIo(window.location.origin, {
      auth: { token: getToken() },
      transports: ["websocket"],
      reconnectionAttempts: 5,
    });
  }
  return socketRef;
}
function logId() { return `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

export default function AiPage() {
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const { data: settings, isLoading: loadingSettings } = useGetAiSettings();

  const [apiKey, setApiKey]       = useState("");
  const [model, setModel]         = useState("");
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [mode, setMode]           = useState<"chat" | "agent">("agent");

  const [chatMsgs, setChatMsgs]       = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput]     = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [agentTasks, setAgentTasks]     = useState<AgentTask[]>([]);
  const [agentInput, setAgentInput]     = useState("");
  const [agentRunning, setAgentRunning] = useState(false);
  const [installing, setInstalling]     = useState(false);
  const agentEndRef = useRef<HTMLDivElement>(null);

  const configured = settings?.configured ?? false;

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMsgs]);
  useEffect(() => { agentEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [agentTasks]);

  // Socket.IO – agent streaming
  useEffect(() => {
    const socket = getOrCreateSocket();
    const onLog = (data: { agentId: string; type: AgentLogType; content: string }) => {
      setAgentTasks(prev => prev.map(task => {
        if (task.agentId !== data.agentId) return task;
        const newLog: AgentLog = { id: logId(), type: data.type, content: data.content, timestamp: Date.now() };
        const all = [...task.logs, newLog];
        const filtered = data.type !== "thinking" ? all.filter(l => l.type !== "thinking") : all;
        return { ...task, logs: filtered, dockerMissing: data.type === "docker_missing" ? true : task.dockerMissing };
      }));
    };
    const onDone = (data: { agentId: string; success: boolean; summary?: string; dockerMissing?: boolean }) => {
      setAgentTasks(prev => prev.map(task =>
        task.agentId !== data.agentId ? task : {
          ...task, done: true, success: data.success, summary: data.summary,
          dockerMissing: data.dockerMissing || task.dockerMissing,
          logs: task.logs.filter(l => l.type !== "thinking"),
        }
      ));
      setAgentRunning(false);
    };
    socket.on("agent:log", onLog);
    socket.on("agent:done", onDone);
    return () => { socket.off("agent:log", onLog); socket.off("agent:done", onDone); };
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!apiKey.trim() || apiKey.trim().length < 8) { toast.error("Please enter a valid NVIDIA API key (at least 8 characters)."); return; }
    setSaving(true);
    try {
      await saveAiSettings(apiKey.trim(), model || undefined);
      toast.success("AI configured successfully!");
      setApiKey(""); setShowSetup(false);
      qc.invalidateQueries({ queryKey: ["ai-settings"] });
    } catch (err: any) { toast.error(err.message || "Failed to save settings"); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteAiSettings();
      toast.success("AI settings removed.");
      qc.invalidateQueries({ queryKey: ["ai-settings"] });
    } catch (err: any) { toast.error(err.message || "Failed to remove settings"); }
    finally { setDeleting(false); }
  }

  async function handleChat(e: React.FormEvent) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    if (!configured) { toast.error("Please configure your AI API key first."); setShowSetup(true); return; }
    const newMsgs: ChatMsg[] = [...chatMsgs, { role: "user", content: text }];
    setChatMsgs(newMsgs); setChatInput(""); setChatLoading(true);
    try {
      const r = await aiChat(newMsgs.map(m => ({ role: m.role, content: m.content })), CHAT_SYSTEM);
      setChatMsgs(prev => [...prev, { role: "assistant", content: r.content }]);
    } catch (err: any) {
      toast.error(err.message || "AI request failed");
      setChatMsgs(prev => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally { setChatLoading(false); }
  }

  async function handleAgentRun(userMsg?: string) {
    const text = (userMsg ?? agentInput).trim();
    if (!text || agentRunning) return;
    if (!configured) { toast.error("Please configure your AI API key first."); setShowSetup(true); return; }
    const agentId = `ag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setAgentTasks(prev => [...prev, { agentId, userMessage: text, logs: [], done: false }]);
    setAgentInput(""); setAgentRunning(true);
    try {
      const res = await agentRun(text, agentId);
      if (res.dockerMissing) {
        setAgentTasks(prev => prev.map(t => t.agentId === agentId ? { ...t, dockerMissing: true, done: true, success: false } : t));
        setAgentRunning(false);
      }
    } catch (err: any) {
      toast.error(err.message || "Agent failed to start");
      setAgentTasks(prev => prev.map(t =>
        t.agentId === agentId
          ? { ...t, done: true, success: false, logs: [...t.logs, { id: logId(), type: "error", content: err.message, timestamp: Date.now() }] }
          : t
      ));
      setAgentRunning(false);
    }
  }

  async function handleInstallDocker() {
    setInstalling(true);
    const installId = `ag_docker_${Date.now()}`;
    setAgentTasks(prev => [...prev, { agentId: installId, userMessage: "Install Docker on this host", logs: [], done: false }]);
    setAgentRunning(true);
    try { await agentInstallDocker(installId); }
    catch (err: any) { toast.error(err.message || "Failed to start Docker installation"); setAgentRunning(false); }
    finally { setInstalling(false); }
  }

  // ── Log renderer ──────────────────────────────────────────────────────────

  function renderAgentLog(log: AgentLog) {
    switch (log.type) {
      case "thinking":
        return (
          <div key={log.id} className="flex items-center gap-2 text-muted-foreground py-0.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span className="text-xs italic">{log.content}</span>
          </div>
        );
      case "ai":
        return (
          <div key={log.id} className="flex gap-2 items-start py-1">
            <Bot className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <span className="text-sm text-foreground/90">{log.content}</span>
          </div>
        );
      case "command":
        return (
          <div key={log.id} className="my-1.5">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Terminal className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Executing</span>
            </div>
            <div className="bg-muted/40 border border-border rounded-lg px-3 py-2 font-mono text-xs text-foreground break-all">
              $ {log.content}
            </div>
          </div>
        );
      case "output":
        return (
          <div key={log.id} className="font-mono text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed px-1">
            {log.content}
          </div>
        );
      case "success":
        return (
          <div key={log.id} className="flex items-center gap-2 text-primary py-0.5">
            <CheckCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="text-xs font-medium">{log.content}</span>
          </div>
        );
      case "error":
        return (
          <div key={log.id} className="flex items-start gap-2 text-destructive py-0.5">
            <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="text-xs font-mono whitespace-pre-wrap">{log.content}</span>
          </div>
        );
      case "info":
        return (
          <div key={log.id} className="flex items-center gap-2 text-muted-foreground py-0.5">
            <Zap className="w-3.5 h-3.5 shrink-0" />
            <span className="text-xs">{log.content}</span>
          </div>
        );
      case "docker_missing":
        return null;
      default:
        return null;
    }
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
              <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <h1 className="font-semibold text-sm tracking-tight">AI DevOps Agent</h1>
            </div>
            <div className="flex items-center gap-2">
              {/* Mode tabs */}
              <div className="flex items-center bg-muted rounded-lg p-0.5 border border-border">
                {(["agent", "chat"] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                      mode === m
                        ? "bg-background text-foreground shadow-sm border border-border"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {m === "agent" ? <Zap className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
                    {m === "agent" ? "Agent" : "Chat"}
                  </button>
                ))}
              </div>
              <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground" onClick={toggle}>
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 flex flex-col max-w-4xl w-full mx-auto px-4 py-6 pb-8 gap-4">

          {/* AI Setup card */}
          <div className="rounded-xl border border-border overflow-hidden">
            <button
              className="w-full px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between hover:bg-muted/50 transition-colors"
              onClick={() => setShowSetup(v => !v)}
            >
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-muted-foreground" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">AI Configuration</span>
                {loadingSettings ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                ) : configured ? (
                  <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 bg-primary/10 text-primary border-primary/20">Configured</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 text-muted-foreground">Not set up</Badge>
                )}
              </div>
              {showSetup ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>

            {showSetup && (
              <div className="p-4 space-y-4">
                {configured && settings?.apiKeyMasked && (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <CheckCircle className="w-4 h-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-primary">AI is active</p>
                      <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{settings.apiKeyMasked} · {settings.model}</p>
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    NVIDIA API Key {configured && <span className="normal-case">(enter a new one to replace)</span>}
                  </label>
                  <Input type="password" placeholder="nvapi-…" value={apiKey} onChange={e => setApiKey(e.target.value)} className="h-9 text-xs font-mono" />
                  <p className="text-[11px] text-muted-foreground">
                    Get your free key at{" "}
                    <a href="https://build.nvidia.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                      build.nvidia.com <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Model</label>
                  <select
                    value={model || settings?.model || NVIDIA_MODELS[0].value}
                    onChange={e => setModel(e.target.value)}
                    className="w-full h-9 text-xs bg-background border border-border rounded-md px-3 focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {NVIDIA_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleSave} disabled={saving || !apiKey.trim()}>
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                    Save & Activate
                  </Button>
                  {configured && (
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive" onClick={handleDelete} disabled={deleting}>
                      {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Remove Key
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── AGENT MODE ─────────────────────────────────────────────────── */}
          {mode === "agent" && (
            <div className="flex flex-col gap-4 flex-1">

              {/* Empty state / quick actions */}
              {agentTasks.length === 0 && (
                <div className="rounded-xl border border-border bg-card p-6 space-y-5">
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 shrink-0">
                      <Zap className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold">DevOps Agent</h2>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        Tell me what to install or run — I'll pull the Docker image, start the container, and show you live logs.
                        If Docker isn't installed, I'll offer to install it for you.
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Quick actions</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {AGENT_PROMPTS.map(p => (
                        <button
                          key={p.label}
                          onClick={() => handleAgentRun(p.prompt)}
                          disabled={agentRunning || !configured}
                          className="flex items-center gap-2 text-left px-3 py-2.5 rounded-lg border border-border bg-background hover:bg-muted/50 hover:border-primary/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <span className="text-muted-foreground shrink-0">{p.icon}</span>
                          <span className="text-xs font-medium">{p.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {!configured && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border text-muted-foreground">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <p className="text-xs">Configure your NVIDIA API key above to use the agent.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Task terminal */}
              {agentTasks.length > 0 && (
                <div className="rounded-xl border border-border overflow-hidden flex flex-col" style={{ minHeight: "480px" }}>
                  {/* Terminal chrome */}
                  <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-destructive/40 border border-destructive/20" />
                        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40 border border-yellow-500/20" />
                        <div className="w-2.5 h-2.5 rounded-full bg-primary/40 border border-primary/20" />
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono ml-1">Agent Output</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {agentRunning && (
                        <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 bg-primary/10 text-primary border-primary/20 animate-pulse">
                          Running
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] text-muted-foreground gap-1 px-2"
                        onClick={() => setAgentTasks([])}
                        disabled={agentRunning}
                      >
                        <RotateCcw className="w-3 h-3" /> Clear
                      </Button>
                    </div>
                  </div>

                  {/* Log stream */}
                  <div className="flex-1 overflow-y-auto bg-background p-4 space-y-4" style={{ maxHeight: "560px" }}>
                    {agentTasks.map((task, ti) => (
                      <div key={task.agentId} className="space-y-1.5">
                        <div className="flex items-center gap-2 mb-2">
                          <User className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs text-foreground font-medium">"{task.userMessage}"</span>
                        </div>

                        <div className="space-y-0.5 pl-5 border-l border-border ml-1.5">
                          {task.logs.map(log => renderAgentLog(log))}
                        </div>

                        {/* Docker missing card */}
                        {task.dockerMissing && task.done && (
                          <div className="ml-5 mt-3 rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                            <div className="flex items-start gap-3">
                              <AlertTriangle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                              <div>
                                <p className="text-sm font-semibold">Docker Not Installed</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Docker is required to run containers. Would you like me to install it automatically?
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                className="h-8 text-xs gap-1.5"
                                onClick={handleInstallDocker}
                                disabled={agentRunning || installing}
                              >
                                {installing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                                Yes, Install Docker
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs"
                                onClick={() => setAgentTasks(prev => prev.map(t => t.agentId === task.agentId ? { ...t, dockerMissing: false } : t))}
                              >
                                No Thanks
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Done banner */}
                        {task.done && !task.dockerMissing && (
                          <div className={cn(
                            "ml-5 mt-2 flex items-center gap-2 py-1.5 px-3 rounded-lg text-xs font-medium border",
                            task.success
                              ? "bg-primary/10 border-primary/20 text-primary"
                              : "bg-destructive/10 border-destructive/20 text-destructive"
                          )}>
                            {task.success
                              ? <CheckCircle className="w-4 h-4 shrink-0" />
                              : <XCircle className="w-4 h-4 shrink-0" />}
                            {task.success ? `Done — ${task.summary || "Task completed"}` : `Failed — ${task.summary || "Task failed"}`}
                          </div>
                        )}

                        {ti < agentTasks.length - 1 && <div className="border-t border-border mt-3 pt-1" />}
                      </div>
                    ))}
                    <div ref={agentEndRef} />
                  </div>
                </div>
              )}

              {/* Agent input */}
              <div className="flex gap-2">
                <Input
                  value={agentInput}
                  onChange={e => setAgentInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAgentRun(); } }}
                  placeholder={configured ? 'e.g. "Install Redis", "Run Nginx on port 80", "Deploy WordPress"…' : "Configure AI first to use the agent"}
                  className="flex-1 h-10 text-sm"
                  disabled={!configured || agentRunning}
                  autoComplete="off"
                />
                <Button
                  size="sm"
                  className="h-10 px-4 gap-1.5"
                  onClick={() => handleAgentRun()}
                  disabled={!configured || !agentInput.trim() || agentRunning}
                >
                  {agentRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  {agentRunning ? "Running…" : "Run"}
                </Button>
              </div>

              {/* Quick-action chips when tasks exist */}
              {agentTasks.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {AGENT_PROMPTS.map(p => (
                    <button
                      key={p.label}
                      onClick={() => handleAgentRun(p.prompt)}
                      disabled={agentRunning || !configured}
                      className="flex items-center gap-1.5 text-[11px] bg-background hover:bg-muted border border-border px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span className="text-muted-foreground">{p.icon}</span>
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── CHAT MODE ──────────────────────────────────────────────────── */}
          {mode === "chat" && (
            <div className="rounded-xl border border-border overflow-hidden flex flex-col" style={{ minHeight: "520px" }}>
              <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-primary" />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">AI Chat</span>
                  {configured && (
                    <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 bg-primary/10 text-primary border-primary/20">
                      <Cpu className="w-2.5 h-2.5 mr-1" />
                      {settings?.model?.split("/").pop() || "AI"}
                    </Badge>
                  )}
                </div>
                {chatMsgs.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground gap-1" onClick={() => setChatMsgs([])}>
                    <RotateCcw className="w-3 h-3" /> Clear
                  </Button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ maxHeight: "480px" }}>
                {chatMsgs.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-8">
                    <Bot className="w-10 h-10 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">
                      {configured ? "Ask anything about containers, databases, or infrastructure." : "Configure your AI API key above to start chatting."}
                    </p>
                    {configured && (
                      <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                        {CHAT_PROMPTS.map(q => (
                          <button
                            key={q}
                            onClick={() => setChatInput(q)}
                            className="text-[11px] bg-muted hover:bg-muted/80 border border-border px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {chatMsgs.map((msg, i) => (
                  <div key={i} className={cn("flex gap-3", msg.role === "user" && "flex-row-reverse")}>
                    <div className={cn(
                      "shrink-0 w-7 h-7 rounded-full flex items-center justify-center border",
                      msg.role === "user"
                        ? "bg-muted border-border text-foreground"
                        : "bg-primary/10 border-primary/20 text-primary"
                    )}>
                      {msg.role === "user" ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                    </div>
                    <div className={cn(
                      "flex-1 max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground ml-auto"
                        : "bg-muted/50 border border-border"
                    )}>
                      <pre className="whitespace-pre-wrap font-sans break-words">{msg.content}</pre>
                    </div>
                  </div>
                ))}

                {chatLoading && (
                  <div className="flex gap-3">
                    <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center border bg-primary/10 border-primary/20 text-primary">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                    <div className="bg-muted/50 border border-border rounded-xl px-4 py-3 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      <span className="text-xs text-muted-foreground">Thinking…</span>
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              <form onSubmit={handleChat} className="border-t border-border bg-background flex items-center gap-2 p-3">
                <Input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder={configured ? "Ask about containers, databases, infrastructure…" : "Set up AI first to start chatting"}
                  className="h-9 text-sm flex-1"
                  disabled={!configured || chatLoading}
                  autoComplete="off"
                />
                <Button type="submit" size="sm" className="h-9 w-9 p-0 shrink-0" disabled={!configured || !chatInput.trim() || chatLoading}>
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
