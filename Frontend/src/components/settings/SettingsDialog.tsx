import React, { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Copy, Check, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";

const DIRECT_LOCAL = "postgresql://postgres.vrqchfsojzchkhdlrhsz:[YOUR-PASSWORD]@127.0.0.1:6543/postgres";
const DIRECT_PUBLIC = "postgresql://postgres.vrqchfsojzchkhdlrhsz:[YOUR-PASSWORD]@[IP Address]:6543/postgres";
const PGBOUNCER_LOCAL = "postgresql://postgres.vrqchfsojzchkhdlrhsz:[YOUR-PASSWORD]@127.0.0.1:6543/postgres";
const PGBOUNCER_PUBLIC = "postgresql://postgres.vrqchfsojzchkhdlrhsz:[YOUR-PASSWORD]@[IP Address]:6543/postgres";

function ConnectionRow({ label, localStr, publicStr }: { label: string; localStr: string; publicStr: string }) {
    const [exposed, setExposed] = useState(false);
    const [copied, setCopied] = useState(false);

    const activeStr = exposed ? publicStr : localStr;

    const handleCopy = () => {
        navigator.clipboard.writeText(activeStr);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground tracking-tight">{label}</span>
                <button
                    onClick={() => setExposed(v => !v)}
                    className={cn(
                        "flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all",
                        exposed
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "bg-muted/60 border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                    )}
                >
                    <span className={cn(
                        "w-1.5 h-1.5 rounded-full transition-colors",
                        exposed ? "bg-primary" : "bg-muted-foreground/50"
                    )} />
                    {exposed ? "Exposed to Everyone" : "Expose Everyone"}
                </button>
            </div>

            <div className="flex items-center gap-2 bg-muted/40 border border-border rounded-lg px-3 py-2">
                <code className="flex-1 text-[11px] font-mono text-muted-foreground truncate">{activeStr}</code>
                <button
                    onClick={handleCopy}
                    className="shrink-0 p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    title="Copy"
                >
                    {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
            </div>
        </div>
    );
}

function ResetDatabaseSection() {
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState("");

    const canConfirm = input === "DELETE";

    const handleReset = () => {
        if (!canConfirm) return;
        setOpen(false);
        setInput("");
        toast.custom((t) => (
            <Alert
                variant="error"
                title="Database Reset"
                description="Your database has been reset successfully."
                onClose={() => toast.dismiss(t)}
            />
        ));
    };

    return (
        <>
            <div className="flex flex-col gap-3 p-4 border border-destructive/20 rounded-xl bg-destructive/5">
                <div className="flex items-start gap-3">
                    <div className="p-1.5 rounded-lg bg-destructive/10 border border-destructive/20 shrink-0">
                        <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">Reset Database</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                            This will permanently erase all data and schemas. This action cannot be undone.
                        </p>
                    </div>
                </div>
                <Button
                    variant="destructive"
                    size="sm"
                    className="w-full h-8 text-xs font-medium"
                    onClick={() => setOpen(true)}
                >
                    Reset Database
                </Button>
            </div>

            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setInput(""); }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-destructive">
                            <AlertTriangle className="w-4 h-4" />
                            Reset Database
                        </DialogTitle>
                    </DialogHeader>

                    <div className="flex flex-col gap-4 pt-1">
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            This action will <span className="text-foreground font-semibold">permanently delete all data</span>, tables, and schemas. There is no way to recover your data after this.
                        </p>

                        <div className="p-3 bg-destructive/5 border border-destructive/20 rounded-lg text-[11px] text-destructive font-mono leading-relaxed">
                            All tables and data will be permanently destroyed.
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs text-muted-foreground">
                                Type <span className="font-mono font-semibold text-foreground">DELETE</span> to confirm
                            </label>
                            <Input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="DELETE"
                                className="font-mono text-sm h-9"
                                onPaste={(e) => e.preventDefault()}
                            />
                        </div>

                        <div className="flex gap-2 pt-1">
                            <Button
                                variant="outline"
                                size="sm"
                                className="flex-1 h-9"
                                onClick={() => { setOpen(false); setInput(""); }}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                className="flex-1 h-9"
                                disabled={!canConfirm}
                                onClick={handleReset}
                            >
                                Yes, Reset Database
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}

interface SettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0">
                <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border bg-background/95 backdrop-blur">
                    <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-muted border border-border">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                                <circle cx="12" cy="12" r="3" />
                            </svg>
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-foreground leading-none">Settings</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5 font-mono uppercase tracking-wide">Database Configuration</p>
                        </div>
                    </div>
                    <DialogClose asChild>
                        <button className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                            <X className="w-4 h-4" />
                        </button>
                    </DialogClose>
                </div>

                <div className="flex flex-col gap-6 px-6 py-5">
                    <section className="flex flex-col gap-4">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Database Connection</span>
                            <div className="flex-1 h-px bg-border/60" />
                        </div>

                        <ConnectionRow
                            label="Direct Connection"
                            localStr={DIRECT_LOCAL}
                            publicStr={DIRECT_PUBLIC}
                        />
                        <ConnectionRow
                            label="PGBouncer Connection"
                            localStr={PGBOUNCER_LOCAL}
                            publicStr={PGBOUNCER_PUBLIC}
                        />
                    </section>

                    <section className="flex flex-col gap-4">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Danger Zone</span>
                            <div className="flex-1 h-px bg-destructive/20" />
                        </div>

                        <ResetDatabaseSection />
                    </section>
                </div>
            </DialogContent>
        </Dialog>
    );
}
