import React, { useEffect, useRef, useState, useCallback } from "react";
import { Terminal, Loader2, Plug, PlugZap, AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { ModeToggle } from "@/components/mode-toggle";
import { getSocket } from "@/api/socket";

// Strip ANSI / VT100 escape sequences so raw PTY output renders as clean text.
function stripAnsi(str: string) {
  return str
    // CSI sequences: ESC [ <param bytes> <intermediate bytes> <final byte>
    // Covers: ESC[...m  ESC[?2004h  ESC[>4;2m  ESC[!p  etc.
    .replace(/\x1B\[[\x20-\x3F]*[\x40-\x7E]/g, "")
    // OSC sequences: ESC ] ... BEL  or  ESC ] ... ESC \
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, "")
    // DCS / PM / APC / SOS: ESC P/^/_ ... ESC \
    .replace(/\x1B[P^_][^\x1B]*\x1B\\/g, "")
    // Two-character escape sequences: ESC followed by one char (charset, etc.)
    .replace(/\x1B[^\[^\]P^_]/g, "")
    // Lone ESC
    .replace(/\x1B/g, "")
    // Non-printable control chars (null, bell, BS, shift-in/out, etc.)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

type Status = "idle" | "connecting" | "connected" | "error";

export default function SshPage() {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [connectedLabel, setConnectedLabel] = useState("");

  const [output, setOutput] = useState("");
  const outputRef = useRef<HTMLDivElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const [termFocused, setTermFocused] = useState(false);
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);

  // Auto-scroll on new output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  // Ensure we always have a live socket and register listeners on it
  function ensureSocket() {
    let s = socketRef.current;
    if (s && (s.connected || s.active)) return s;
    // existing socket is dead — get/create a fresh one
    s = getSocket();
    socketRef.current = s;
    // re-attach SSH listeners to the new socket instance
    s.off("ssh:ready").off("ssh:output").off("ssh:error").off("ssh:closed");
    s.on("ssh:ready", () => setStatus("connected"));
    s.on("ssh:output", ({ data }: { data: string }) => setOutput(prev => prev + data));
    s.on("ssh:error", ({ message }: { message: string }) => { setStatus("error"); setErrorMsg(message); });
    s.on("ssh:closed", () => { setStatus("idle"); setOutput(prev => prev + "\n\n[SSH session closed]\n"); });
    return s;
  }

  // Register socket listeners on mount
  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    const onReady = () => setStatus("connected");
    const onOutput = ({ data }: { data: string }) => setOutput(prev => prev + data);
    const onError = ({ message }: { message: string }) => { setStatus("error"); setErrorMsg(message); };
    const onClosed = () => { setStatus("idle"); setOutput(prev => prev + "\n\n[SSH session closed]\n"); };

    socket.on("ssh:ready", onReady);
    socket.on("ssh:output", onOutput);
    socket.on("ssh:error", onError);
    socket.on("ssh:closed", onClosed);

    return () => {
      socket.off("ssh:ready", onReady);
      socket.off("ssh:output", onOutput);
      socket.off("ssh:error", onError);
      socket.off("ssh:closed", onClosed);
    };
  }, []);

  function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!host.trim() || !username.trim() || !password) return;
    setStatus("connecting");
    setErrorMsg("");
    setOutput("");
    setConnectedLabel(`${username}@${host}`);
    const socket = ensureSocket();
    socket.emit("ssh:connect", {
      host: host.trim(),
      port: parseInt(port) || 22,
      username: username.trim(),
      password,
    });
  }

  function handleDisconnect() {
    const socket = ensureSocket();
    socket.emit("ssh:disconnect");
    setStatus("idle");
    setOutput("");
  }

  function handleClear() {
    setOutput("");
  }

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (status !== "connected") return;
    const socket = socketRef.current;
    if (!socket) return;

    // Don't prevent default for browser shortcuts
    if ((e.metaKey || (e.ctrlKey && !["c","d","z","a","e","k","u","w","l"].includes(e.key.toLowerCase())))) return;

    e.preventDefault();

    let data = "";

    if (e.ctrlKey && e.key.length === 1) {
      const code = e.key.toLowerCase().charCodeAt(0) - 96;
      if (code > 0 && code < 32) {
        data = String.fromCharCode(code);
      }
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      data = e.key;
    } else {
      switch (e.key) {
        case "Enter":       data = "\r"; break;
        case "Backspace":   data = "\x7f"; break;
        case "Tab":         data = "\t"; break;
        case "Escape":      data = "\x1b"; break;
        case "ArrowUp":     data = "\x1b[A"; break;
        case "ArrowDown":   data = "\x1b[B"; break;
        case "ArrowRight":  data = "\x1b[C"; break;
        case "ArrowLeft":   data = "\x1b[D"; break;
        case "Home":        data = "\x1b[H"; break;
        case "End":         data = "\x1b[F"; break;
        case "Delete":      data = "\x1b[3~"; break;
        case "PageUp":      data = "\x1b[5~"; break;
        case "PageDown":    data = "\x1b[6~"; break;
      }
    }

    if (data) socket.emit("ssh:input", { data });
  }, [status]);

  function focusTerminal() {
    if (status === "connected") hiddenInputRef.current?.focus();
  }

  const displayText = stripAnsi(output);

  return (
    <div className="h-screen bg-background text-foreground flex overflow-hidden">
      <DesktopSidebar />
      <div className="flex-1 flex flex-col min-w-0 h-screen">

        {/* Header */}
        <header className="border-b border-border bg-background shrink-0">
          <div className="px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MobileSidebarTrigger />
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-primary/10 border border-primary/20">
                  <PlugZap className="w-3.5 h-3.5 text-primary" />
                </div>
                <span className="font-semibold text-sm">SSH Session</span>
                {status === "connected" && (
                  <Badge variant="outline" className="text-[10px] font-mono rounded-full px-2 py-0 h-4 text-emerald-500 bg-emerald-500/10 border-emerald-500/20">
                    {connectedLabel}
                  </Badge>
                )}
                {status === "connecting" && (
                  <Badge variant="outline" className="text-[10px] font-mono rounded-full px-2 py-0 h-4 text-amber-500 bg-amber-500/10 border-amber-500/20 gap-1">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" /> Connecting…
                  </Badge>
                )}
                {status === "error" && (
                  <Badge variant="outline" className="text-[10px] font-mono rounded-full px-2 py-0 h-4 text-red-500 bg-red-500/10 border-red-500/20 gap-1">
                    <AlertTriangle className="w-2.5 h-2.5" /> Failed
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {status === "connected" && (
                <Button variant="outline" size="sm" className="h-8 rounded-lg text-xs gap-1.5 px-3 text-red-500 border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={handleDisconnect}>
                  <Plug className="w-3.5 h-3.5" /> Disconnect
                </Button>
              )}
              <ModeToggle />
            </div>
          </div>
        </header>

        <main className="flex-1 flex flex-col overflow-hidden">

          {/* ── Connection Form (shown when not connected) ─────────── */}
          {status !== "connected" && (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="w-full max-w-sm space-y-6">
                <div className="text-center space-y-1">
                  <div className="inline-flex p-3 rounded-xl bg-primary/10 border border-primary/20 mb-2">
                    <PlugZap className="w-6 h-6 text-primary" />
                  </div>
                  <h2 className="text-lg font-semibold">New SSH Session</h2>
                  <p className="text-sm text-muted-foreground">Connect to any server over SSH</p>
                </div>

                {status === "error" && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 px-3 py-2.5 text-xs text-red-600 dark:text-red-400">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{errorMsg || "Connection failed"}</span>
                  </div>
                )}

                <form onSubmit={handleConnect} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Host / IP</Label>
                    <Input
                      value={host}
                      onChange={e => setHost(e.target.value)}
                      placeholder="192.168.1.1 or example.com"
                      className="font-mono text-sm"
                      autoComplete="off"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 space-y-1.5">
                      <Label className="text-xs font-medium">Username</Label>
                      <Input
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        placeholder="root"
                        className="font-mono text-sm"
                        autoComplete="username"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Port</Label>
                      <Input
                        value={port}
                        onChange={e => setPort(e.target.value)}
                        placeholder="22"
                        className="font-mono text-sm"
                        type="number"
                        min={1}
                        max={65535}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Password</Label>
                    <Input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      required
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-9 gap-2"
                    disabled={status === "connecting" || !host.trim() || !username.trim() || !password}
                  >
                    {status === "connecting"
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting…</>
                      : <><PlugZap className="w-3.5 h-3.5" /> Connect</>
                    }
                  </Button>
                </form>
              </div>
            </div>
          )}

          {/* ── SSH Terminal (shown when connected) ────────────────── */}
          {status === "connected" && (
            <div
              className="flex-1 overflow-hidden flex flex-col cursor-text border-[#e0e0e0] dark:border-[#252525] bg-[#f8f8f8] dark:bg-[#0d0d0d]"
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
                  <Terminal className="w-3 h-3 text-[#aaa] dark:text-[#555]" />
                  <span className="text-[11px] font-mono select-none text-[#aaa] dark:text-[#555]">
                    {connectedLabel}
                  </span>
                </div>
                <Button
                  variant="ghost" size="sm"
                  className="h-6 px-2 text-[10px] text-[#aaa] dark:text-[#555] hover:text-[#555] dark:hover:text-[#999] hover:bg-[#e0e0e0] dark:hover:bg-[#222] rounded gap-1"
                  onClick={e => { e.stopPropagation(); handleClear(); }}
                >
                  <Trash2 className="w-3 h-3" /> Clear
                </Button>
              </div>

              {/* Output */}
              <div
                ref={outputRef}
                className="flex-1 overflow-y-auto p-4 font-mono text-[13px] leading-[1.6] select-text"
              >
                <pre className="whitespace-pre-wrap break-words text-[#111] dark:text-[#e5e5e5] m-0">
                  {displayText}
                </pre>
              </div>

              {/* Hidden keyboard capture input */}
              <input
                ref={hiddenInputRef}
                onKeyDown={handleKey}
                onChange={() => {
                  // keep input empty so characters don't accumulate in the field
                  if (hiddenInputRef.current) hiddenInputRef.current.value = "";
                }}
                onFocus={() => setTermFocused(true)}
                onBlur={() => setTermFocused(false)}
                className="sr-only"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-label="SSH terminal input"
              />

              {/* Click-to-focus hint */}
              {!termFocused && (
                <div className="shrink-0 flex items-center justify-center py-2 border-t border-[#e0e0e0] dark:border-[#252525] bg-[#f8f8f8] dark:bg-[#0d0d0d]">
                  <span className="text-[11px] text-[#aaa] dark:text-[#555]">Click the terminal to start typing</span>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
