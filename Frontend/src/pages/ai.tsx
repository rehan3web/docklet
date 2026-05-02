import React, { useState } from "react";
import { Sparkles, Key, Cpu, CheckCircle, XCircle, Loader2, Trash2, Send, Bot, User, RotateCcw, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { useGetAiSettings, saveAiSettings, deleteAiSettings, aiChat } from "@/api/client";
import { useQueryClient } from "@tanstack/react-query";
import { Sun, Moon } from "lucide-react";

const NVIDIA_MODELS = [
  { value: "openai/gpt-oss-120b",       label: "GPT-OSS 120B (Default)" },
  { value: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B Instruct" },
  { value: "meta/llama-3.1-405b-instruct", label: "Llama 3.1 405B Instruct" },
  { value: "mistralai/mistral-large-2-instruct", label: "Mistral Large 2" },
  { value: "nvidia/nemotron-4-340b-instruct", label: "Nemotron 4 340B" },
  { value: "google/gemma-3-27b-it",     label: "Gemma 3 27B IT" },
];

type ChatMessage = { role: "user" | "assistant"; content: string };

const SYSTEM_CONTEXT =
  "You are a helpful Docker, DevOps, and infrastructure assistant integrated into Docklet — a VPS/Docker/PostgreSQL management dashboard. " +
  "Help with container management, networking, debugging, SQL, shell commands, and infrastructure questions. " +
  "Be concise, practical, and give actionable answers. Use markdown for code blocks.";

export default function AiPage() {
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const { data: settings, isLoading: loadingSettings } = useGetAiSettings();

  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSave() {
    if (!apiKey.trim() || apiKey.trim().length < 8) {
      toast.error("Please enter a valid NVIDIA API key (at least 8 characters).");
      return;
    }
    setSaving(true);
    try {
      await saveAiSettings(apiKey.trim(), model || undefined);
      toast.success("AI configured successfully!");
      setApiKey("");
      setShowSetup(false);
      qc.invalidateQueries({ queryKey: ["ai-settings"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteAiSettings();
      toast.success("AI settings removed.");
      qc.invalidateQueries({ queryKey: ["ai-settings"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to remove settings");
    } finally {
      setDeleting(false);
    }
  }

  async function handleChat(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || chatLoading) return;
    if (!settings?.configured) {
      toast.error("Please configure your AI API key first.");
      setShowSetup(true);
      return;
    }

    const newMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setChatLoading(true);

    try {
      const r = await aiChat(
        newMessages.map(m => ({ role: m.role, content: m.content })),
        SYSTEM_CONTEXT
      );
      setMessages(prev => [...prev, { role: "assistant", content: r.content }]);
    } catch (err: any) {
      toast.error(err.message || "AI request failed");
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally {
      setChatLoading(false);
    }
  }

  const configured = settings?.configured ?? false;

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <DesktopSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="px-4 h-14 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <MobileSidebarTrigger />
              <Sparkles className="w-5 h-5 text-violet-500" />
              <h1 className="font-semibold text-sm tracking-tight">AI Assistant</h1>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground" onClick={toggle}>
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 flex flex-col max-w-4xl w-full mx-auto px-4 py-6 pb-24 gap-6">

          {/* Setup / Status Card */}
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
                  <Badge className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 rounded-full px-2 py-0">Configured</Badge>
                ) : (
                  <Badge className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 rounded-full px-2 py-0">Not set up</Badge>
                )}
              </div>
              {showSetup ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>

            {showSetup && (
              <div className="p-4 space-y-4">
                {configured && settings?.apiKeyMasked && (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                    <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">AI is active</p>
                      <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{settings.apiKeyMasked} · {settings.model}</p>
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    NVIDIA API Key {configured && <span className="normal-case">(enter a new one to replace)</span>}
                  </label>
                  <Input
                    type="password"
                    placeholder="nvapi-…"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    className="h-9 text-xs font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Get your free API key at{" "}
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
                    {NVIDIA_MODELS.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={handleSave}
                    disabled={saving || !apiKey.trim()}
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                    Save & Activate
                  </Button>
                  {configured && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive"
                      onClick={handleDelete}
                      disabled={deleting}
                    >
                      {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Remove Key
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Capabilities Info */}
          {!configured && !showSetup && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto">
                <Sparkles className="w-7 h-7 text-violet-500" />
              </div>
              <div>
                <h2 className="text-base font-semibold">AI-Powered Infrastructure Assistant</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                  Connect your NVIDIA API key once to unlock AI across the whole dashboard — log analysis, container Q&A, command suggestions, and more.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left max-w-lg mx-auto">
                {[
                  { icon: "🔍", title: "Log Analysis", desc: "Auto-diagnose container health, crashes, and errors" },
                  { icon: "💬", title: "Container Chat", desc: "Ask questions about any container in natural language" },
                  { icon: "⚡", title: "Command Assist", desc: "AI-powered shell command suggestions in the terminal" },
                ].map(f => (
                  <div key={f.title} className="rounded-lg border border-border bg-muted/20 p-3 space-y-1">
                    <span className="text-lg">{f.icon}</span>
                    <p className="text-xs font-medium">{f.title}</p>
                    <p className="text-[11px] text-muted-foreground">{f.desc}</p>
                  </div>
                ))}
              </div>
              <Button size="sm" className="h-9 gap-2" onClick={() => setShowSetup(true)}>
                <Key className="w-4 h-4" />Set Up AI
              </Button>
            </div>
          )}

          {/* Chat Interface */}
          <div className="rounded-xl border border-border overflow-hidden flex flex-col" style={{ minHeight: "480px" }}>
            <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-violet-500" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">AI Chat</span>
                {configured && (
                  <Badge className="text-[10px] bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20 rounded-full px-2 py-0">
                    <Cpu className="w-2.5 h-2.5 mr-1" />
                    {settings?.model?.split("/").pop() || "AI"}
                  </Badge>
                )}
              </div>
              {messages.length > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground gap-1" onClick={() => setMessages([])}>
                  <RotateCcw className="w-3 h-3" />Clear
                </Button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ maxHeight: "460px" }}>
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-8">
                  <Bot className="w-10 h-10 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    {configured
                      ? "Ask anything about your containers, servers, databases, or infrastructure."
                      : "Configure your AI API key above to start chatting."}
                  </p>
                  {configured && (
                    <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                      {[
                        "Why would a container keep restarting?",
                        "How do I check PostgreSQL logs?",
                        "What does OOMKilled mean?",
                        "How to limit container memory?",
                      ].map(q => (
                        <button
                          key={q}
                          onClick={() => setInput(q)}
                          className="text-[11px] bg-muted hover:bg-muted/80 border border-border px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
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
                  <div className={`flex-1 max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground ml-auto"
                      : "bg-muted/50 border border-border"
                  }`}>
                    <pre className="whitespace-pre-wrap font-sans break-words">{msg.content}</pre>
                  </div>
                </div>
              ))}

              {chatLoading && (
                <div className="flex gap-3">
                  <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center border bg-violet-500/10 border-violet-500/20 text-violet-500">
                    <Bot className="w-3.5 h-3.5" />
                  </div>
                  <div className="bg-muted/50 border border-border rounded-xl px-4 py-3 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
                    <span className="text-xs text-muted-foreground">Thinking…</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleChat} className="border-t border-border bg-background flex items-center gap-2 p-3">
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={configured ? "Ask about containers, databases, infrastructure…" : "Set up AI first to start chatting"}
                className="h-9 text-sm flex-1"
                disabled={!configured || chatLoading}
                autoComplete="off"
              />
              <Button type="submit" size="sm" className="h-9 w-9 p-0 shrink-0" disabled={!configured || !input.trim() || chatLoading}>
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
