import React, { useState } from "react";
import { DesktopSidebar, MobileSidebarTrigger, IconSettings } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sun, Moon, Copy, Check, AlertTriangle, Globe, Lock, PauseCircle, PlayCircle, RefreshCw, Loader2 } from "lucide-react";
import { cn, copyToClipboard } from "@/lib/utils";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import {
    pauseDatabase, resumeDatabase, resetDatabase,
    useGetConnectionConfig, exposeDatabase, unexposeDatabase,
    type ConnectionConfig, type ExposeResult,
} from "@/api/client";
import { useQueryClient } from "@tanstack/react-query";

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    const handle = () => {
        copyToClipboard(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <button onClick={handle} className="shrink-0 p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" title="Copy">
            {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
    );
}

function ConnRow({ label, icon, value, highlight }: { label: string; icon: React.ReactNode; value: string; highlight?: boolean }) {
    return (
        <div className={cn("flex items-center gap-3 px-5 py-3", highlight && "bg-primary/5")}>
            <div className="flex items-center gap-1.5 shrink-0">
                {icon}
                <span className={cn("text-[10px] font-semibold uppercase tracking-widest w-12", highlight ? "text-primary" : "text-muted-foreground")}>{label}</span>
            </div>
            <code className={cn("flex-1 text-[12px] font-mono bg-muted/30 rounded-lg px-3 py-2 truncate", highlight ? "text-foreground bg-primary/10 border border-primary/20" : "text-muted-foreground")}>{value}</code>
            <CopyButton text={value} />
        </div>
    );
}

function ConnectionCard({
    title,
    localStr,
    publicStr,
    exposed,
    onExpose,
    onUnexpose,
    exposeLoading,
}: {
    title: string;
    localStr: string;
    publicStr: string;
    exposed: boolean;
    onExpose: () => void;
    onUnexpose: () => void;
    exposeLoading: boolean;
}) {
    return (
        <div className="border border-border rounded-xl bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20">
                        <svg className="w-3.5 h-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <ellipse cx="12" cy="5" rx="9" ry="3" />
                            <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
                            <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
                        </svg>
                    </div>
                    <span className="text-sm font-semibold text-foreground">{title}</span>
                </div>
                <button
                    onClick={exposed ? onUnexpose : onExpose}
                    disabled={exposeLoading}
                    className={cn(
                        "flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-all",
                        exposed
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "bg-muted/60 border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/30",
                        exposeLoading && "opacity-60 cursor-not-allowed"
                    )}
                >
                    {exposeLoading
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : exposed
                            ? <Globe className="w-3 h-3" />
                            : <Lock className="w-3 h-3" />}
                    {exposeLoading ? "Working..." : exposed ? "Remove Public" : "Expose Public"}
                </button>
            </div>
            <div className="flex flex-col divide-y divide-border">
                <ConnRow
                    label="Local"
                    icon={<Lock className="w-3 h-3 text-muted-foreground/60" />}
                    value={localStr}
                />
                {exposed && (
                    <ConnRow
                        label="Public"
                        icon={<Globe className="w-3 h-3 text-primary/70" />}
                        value={publicStr}
                        highlight
                    />
                )}
            </div>
        </div>
    );
}

function ConnectionSection() {
    const qc = useQueryClient();
    const { data: cfg, isLoading } = useGetConnectionConfig();
    const [exposeLoading, setExposeLoading] = useState(false);
    const [liveExposed, setLiveExposed] = useState<ExposeResult | null>(null);

    const exposed = liveExposed?.exposed ?? cfg?.exposed ?? false;

    const directPublic = liveExposed?.directPublic ?? cfg?.directPublic ?? "";
    const poolerPublic = liveExposed?.poolerPublic ?? cfg?.poolerPublic ?? "";

    const handleExpose = async () => {
        setExposeLoading(true);
        try {
            const result = await exposeDatabase();
            setLiveExposed(result);
            const modeLabel = result.mode === 'docker' ? 'Docker containers restarted' :
                result.mode === 'docker-config-updated' ? 'postgres.yml updated — restart containers to apply' :
                'postgres.yml updated — run docker compose up -d --force-recreate postgres pgbouncer';
            toast.custom((t) => (
                <Alert variant="success" title="Public Access Enabled"
                    description={`${modeLabel}. Connect via ${result.serverIp}:${result.directPublicPort}`}
                    onClose={() => toast.dismiss(t)} />
            ));
            qc.invalidateQueries({ queryKey: ["admin-connection-config"] });
        } catch (err: any) {
            toast.custom((t) => (
                <Alert variant="error" title="Expose Failed" description={err.message} onClose={() => toast.dismiss(t)} />
            ));
        } finally {
            setExposeLoading(false);
        }
    };

    const handleUnexpose = async () => {
        setExposeLoading(true);
        try {
            const result = await unexposeDatabase();
            setLiveExposed({ exposed: false });
            toast.custom((t) => (
                <Alert variant="warning" title="Public Access Removed"
                    description={(result as any).note || "postgres.yml restored to local-only binding."}
                    onClose={() => toast.dismiss(t)} />
            ));
            qc.invalidateQueries({ queryKey: ["admin-connection-config"] });
        } catch (err: any) {
            toast.custom((t) => (
                <Alert variant="error" title="Error" description={err.message} onClose={() => toast.dismiss(t)} />
            ));
        } finally {
            setExposeLoading(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading connection config…
            </div>
        );
    }

    const directLocal = cfg?.directLocal ?? `postgresql://postgres@127.0.0.1:5432/postgres`;
    const poolerLocal = cfg?.poolerLocal ?? `postgresql://postgres@127.0.0.1:6543/postgres`;

    return (
        <div className="flex flex-col gap-4">
            <ConnectionCard
                title={`Direct Connection${cfg ? ` · ${cfg.containerName}` : ''}`}
                localStr={directLocal}
                publicStr={directPublic}
                exposed={exposed}
                onExpose={handleExpose}
                onUnexpose={handleUnexpose}
                exposeLoading={exposeLoading}
            />
            <ConnectionCard
                title={`Pooler Connection${cfg ? ` · ${cfg.poolerContainer}` : ''}`}
                localStr={poolerLocal}
                publicStr={poolerPublic}
                exposed={exposed}
                onExpose={handleExpose}
                onUnexpose={handleUnexpose}
                exposeLoading={exposeLoading}
            />
            {cfg && (
                <div className="flex items-center gap-4 px-1 text-[11px] text-muted-foreground/60 font-mono">
                    <span>Server IP: <span className="text-foreground/70">{cfg.serverIp}</span></span>
                    <span>·</span>
                    <span>DB: <span className="text-foreground/70">{cfg.db}</span></span>
                    <span>·</span>
                    <span>User: <span className="text-foreground/70">{cfg.user}</span></span>
                </div>
            )}
        </div>
    );
}

function PauseDatabaseCard() {
    const [paused, setPaused] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleToggle = async () => {
        setLoading(true);
        try {
            if (paused) {
                await resumeDatabase();
                setPaused(false);
                toast.custom((t) => (<Alert variant="success" title="Database Resumed" description="Your database is now active and accepting connections." onClose={() => toast.dismiss(t)} />));
            } else {
                await pauseDatabase();
                setPaused(true);
                toast.custom((t) => (<Alert variant="warning" title="Database Paused" description="All connections have been suspended. Resume to restore access." onClose={() => toast.dismiss(t)} />));
            }
        } catch (err: any) {
            toast.custom((t) => (<Alert variant="error" title="Error" description={err.message} onClose={() => toast.dismiss(t)} />));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={cn("border rounded-xl overflow-hidden transition-colors", paused ? "border-yellow-500/30 bg-yellow-500/5" : "border-border bg-card")}>
            <div className={cn("flex items-center justify-between px-5 py-4 border-b", paused ? "border-yellow-500/20 bg-yellow-500/10" : "border-border bg-muted/20")}>
                <div className="flex items-center gap-2">
                    <div className={cn("p-1.5 rounded-lg border", paused ? "bg-yellow-500/10 border-yellow-500/30" : "bg-primary/10 border-primary/20")}>
                        {paused ? <PauseCircle className="w-3.5 h-3.5 text-yellow-500" /> : <PlayCircle className="w-3.5 h-3.5 text-primary" />}
                    </div>
                    <span className="text-sm font-semibold text-foreground">Pause Database</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className={cn("w-1.5 h-1.5 rounded-full", paused ? "bg-yellow-500" : "bg-primary animate-pulse")} />
                    <span className={cn("text-[10px] font-semibold uppercase tracking-widest", paused ? "text-yellow-500" : "text-primary")}>
                        {paused ? "Paused" : "Running"}
                    </span>
                </div>
            </div>
            <div className="px-5 py-4 flex items-start justify-between gap-6">
                <p className="text-sm text-muted-foreground leading-relaxed">
                    {paused
                        ? "Database is currently paused. All connections are suspended. Resume to restore access."
                        : "Pausing the database will suspend all active connections. No data will be lost."}
                </p>
                <Button
                    size="sm" variant="outline"
                    className={cn("shrink-0 h-8 px-4 text-xs font-medium gap-1.5 transition-colors",
                        paused ? "border-primary/40 text-primary hover:bg-primary/10" : "border-yellow-500/40 text-yellow-500 hover:bg-yellow-500/10")}
                    onClick={handleToggle}
                    disabled={loading}
                >
                    {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : paused ? <PlayCircle className="w-3.5 h-3.5" /> : <PauseCircle className="w-3.5 h-3.5" />}
                    {loading ? (paused ? "Resuming..." : "Pausing...") : paused ? "Resume Database" : "Pause Database"}
                </Button>
            </div>
        </div>
    );
}

function ResetDatabaseCard() {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const canConfirm = input === "DELETE";

    const handleReset = async () => {
        if (!canConfirm) return;
        setLoading(true);
        try {
            const result = await resetDatabase();
            setConfirmOpen(false);
            setInput("");
            toast.custom((t) => (<Alert variant="error" title="Database Reset" description={`${result.dropped} table(s) dropped. Database has been reset.`} onClose={() => toast.dismiss(t)} />));
        } catch (err: any) {
            toast.custom((t) => (<Alert variant="error" title="Reset Failed" description={err.message} onClose={() => toast.dismiss(t)} />));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="border border-destructive/25 rounded-xl bg-destructive/5 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-destructive/20">
                <div className="p-1.5 rounded-lg bg-destructive/10 border border-destructive/20">
                    <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                </div>
                <span className="text-sm font-semibold text-foreground">Reset Database</span>
            </div>
            <div className="px-5 py-4 flex items-start justify-between gap-6">
                <p className="text-sm text-muted-foreground leading-relaxed">
                    Permanently erase all data, tables, and schemas. This action cannot be undone.
                </p>
                {!confirmOpen ? (
                    <Button variant="destructive" size="sm" className="shrink-0 h-8 px-4 text-xs font-medium" onClick={() => setConfirmOpen(true)}>
                        Reset Database
                    </Button>
                ) : (
                    <div className="flex flex-col gap-3 w-full max-w-sm">
                        <p className="text-xs text-muted-foreground">
                            Type <span className="font-mono font-bold text-foreground">DELETE</span> to confirm
                        </p>
                        <Input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="DELETE"
                            className="font-mono text-sm h-9"
                            autoFocus
                            onPaste={(e) => e.preventDefault()}
                        />
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => { setConfirmOpen(false); setInput(""); }}>
                                Cancel
                            </Button>
                            <Button
                                variant="destructive" size="sm"
                                className="flex-1 h-8 text-xs gap-1.5"
                                disabled={!canConfirm || loading}
                                onClick={handleReset}
                            >
                                {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                                {loading ? "Resetting..." : "Confirm Reset"}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function SettingsPage() {
    const { theme, toggle } = useTheme();

    return (
        <div className="min-h-screen bg-background text-foreground flex">
            <DesktopSidebar />
            <div className="flex-1 flex flex-col min-w-0">
                <header className="h-14 border-b border-border bg-background flex items-center justify-between px-6 shrink-0 sticky top-0 z-10">
                    <div className="flex items-center gap-4">
                        <MobileSidebarTrigger />
                        <div className="flex items-center gap-2">
                            <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0">
                                <IconSettings className="w-4 h-4 text-primary" />
                            </div>
                            <h1 className="text-sm font-semibold tracking-tight">Settings</h1>
                        </div>
                    </div>
                    <Button
                        variant="ghost" size="icon"
                        className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60"
                        onClick={toggle}
                        aria-label="Toggle theme"
                    >
                        {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </Button>
                </header>
                <main className="flex-1 px-6 py-8 max-w-3xl w-full mx-auto flex flex-col gap-10">
                    <div>
                        <h2 className="text-xl font-bold text-foreground tracking-tight">Settings</h2>
                        <p className="text-sm text-muted-foreground mt-1">Manage your database connections and configuration.</p>
                    </div>
                    <section className="flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Database Connection</h3>
                            <div className="flex-1 h-px bg-border" />
                        </div>
                        <ConnectionSection />
                    </section>
                    <section className="flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Database Management</h3>
                            <div className="flex-1 h-px bg-border" />
                        </div>
                        <PauseDatabaseCard />
                    </section>
                    <section className="flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Danger Zone</h3>
                            <div className="flex-1 h-px bg-destructive/30" />
                        </div>
                        <ResetDatabaseCard />
                    </section>
                </main>
            </div>
        </div>
    );
}
