import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Sun, Moon, Github, Terminal, CheckCheck, Copy, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTheme } from "@/hooks/use-theme";

interface Step {
    number: number;
    title: string;
    description: string;
    commands: { label: string; code: string }[];
    note?: string;
}

const STEPS: Step[] = [
    {
        number: 1,
        title: "SSH into your server",
        description: "Open a terminal on your local machine and connect to the server where Docklet is running.",
        commands: [
            { label: "Connect via SSH", code: "ssh your_user@your-server-ip" },
        ],
        note: "Replace your_user and your-server-ip with your actual credentials.",
    },
    {
        number: 2,
        title: "Navigate to the Docklet directory",
        description: "Change into the folder where you cloned the project.",
        commands: [
            { label: "Go to project folder", code: "cd /path/to/docklet" },
        ],
        note: "Use the actual path where you ran git clone.",
    },
    {
        number: 3,
        title: "Edit the .env file",
        description: "Open the .env file and update ADMIN_USERNAME and/or ADMIN_PASSWORD to your new values.",
        commands: [
            { label: "Open with nano", code: "nano .env" },
            { label: "Or open with vim", code: "vim .env" },
        ],
        note: "Change the ADMIN_USERNAME= and ADMIN_PASSWORD= lines, then save (Ctrl+O → Enter → Ctrl+X for nano, :wq for vim).",
    },
    {
        number: 4,
        title: "Restart the containers",
        description: "Apply the new credentials by restarting Docklet. Docker Compose will read the updated .env automatically.",
        commands: [
            { label: "Restart all services", code: "docker compose -f postgres.yml up -d" },
        ],
    },
    {
        number: 5,
        title: "Log in with your new credentials",
        description: "Go back to the login page and sign in using the username and password you just set in the .env file.",
        commands: [],
    },
];

function CodeBlock({ code, label }: { code: string; label: string }) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="mt-2">
            <p className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wider">{label}</p>
            <div className="flex items-center gap-2 bg-muted/60 border border-border rounded-lg px-3 py-2.5 group">
                <Terminal className="w-3 h-3 text-primary shrink-0" />
                <code className="text-xs font-mono text-foreground flex-1 break-all select-all">{code}</code>
                <button
                    onClick={copy}
                    className="ml-2 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy command"
                >
                    {copied
                        ? <CheckCheck className="w-3.5 h-3.5 text-green-500" />
                        : <Copy className="w-3.5 h-3.5" />
                    }
                </button>
            </div>
        </div>
    );
}

export default function ForgotPasswordPage() {
    const [, setLocation] = useLocation();
    const { theme, toggle } = useTheme();

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-4 relative overflow-hidden">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

            <div className="absolute top-4 right-4 flex items-center gap-2">
                <Button variant="ghost" size="icon" className="w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" asChild>
                    <a href="https://github.com/rehanweb3/DBCraft-2.0" target="_blank" rel="noreferrer"><Github className="w-4 h-4" /></a>
                </Button>
                <Button variant="ghost" size="icon" className="w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" onClick={toggle}>
                    {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </Button>
            </div>

            <div className="w-full max-w-[520px] z-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col items-center mb-8 text-center">
                    <div className="h-16 flex items-center justify-center mb-4">
                        <img
                            src={theme === "dark" ? "/dark.png" : "/white.png"}
                            alt="Docklet"
                            className="max-h-full w-auto object-contain"
                        />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">Reset Password</h1>
                    <p className="text-sm text-muted-foreground mt-1">No email required — update credentials directly on your server</p>
                </div>

                <Card className="bg-background border-border shadow-none rounded-2xl overflow-hidden">
                    <div className="px-6 pt-6 pb-2">
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            Docklet credentials are stored in the <code className="bg-muted px-1 py-0.5 rounded text-[11px] font-mono">.env</code> file on your server.
                            Follow the steps below to update them.
                        </p>
                    </div>

                    <div className="px-6 py-4 space-y-5">
                        {STEPS.map((step, idx) => (
                            <div key={step.number} className="relative">
                                {idx < STEPS.length - 1 && (
                                    <div className="absolute left-[15px] top-[32px] w-px h-[calc(100%+8px)] bg-border" />
                                )}
                                <div className="flex gap-3">
                                    <div className="shrink-0 w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center z-10">
                                        <span className="text-[11px] font-bold text-primary">{step.number}</span>
                                    </div>
                                    <div className="flex-1 pb-2">
                                        <div className="flex items-center gap-1.5">
                                            <p className="text-sm font-semibold text-foreground">{step.title}</p>
                                            {step.number === 5 && (
                                                <span className="text-[10px] bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 rounded-full px-2 py-0.5 font-medium">Done!</span>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.description}</p>
                                        {step.commands.map(cmd => (
                                            <CodeBlock key={cmd.code} code={cmd.code} label={cmd.label} />
                                        ))}
                                        {step.note && (
                                            <p className="text-[11px] text-muted-foreground/70 mt-2 leading-relaxed border-l-2 border-primary/30 pl-2">
                                                {step.note}
                                            </p>
                                        )}
                                        {step.number === 3 && (
                                            <div className="mt-3 bg-muted/40 border border-border rounded-lg px-3 py-2.5">
                                                <p className="text-[10px] text-muted-foreground uppercase font-medium tracking-wider mb-1.5">Lines to edit in .env</p>
                                                <code className="text-xs font-mono text-foreground block">ADMIN_USERNAME=<span className="text-primary">your_new_username</span></code>
                                                <code className="text-xs font-mono text-foreground block">ADMIN_PASSWORD=<span className="text-primary">your_new_password</span></code>
                                            </div>
                                        )}
                                        {step.number === 5 && (
                                            <Button
                                                onClick={() => setLocation("/login")}
                                                className="mt-3 h-9 gap-2 rounded-xl text-xs font-medium transition-all border border-black/10 dark:border-white/10 shadow-none bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47]"
                                            >
                                                Go to Login <ChevronRight className="w-3.5 h-3.5" />
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="px-6 pb-6 pt-2 border-t border-border">
                        <button
                            onClick={() => setLocation("/login")}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <ArrowLeft className="w-3.5 h-3.5" /> Back to Login
                        </button>
                    </div>
                </Card>
            </div>

            <div className="absolute bottom-6 w-full text-center">
                <p className="text-[10px] text-muted-foreground/40 font-mono tracking-widest uppercase">© 2026 Docklet · All Rights Reserved</p>
            </div>
        </div>
    );
}
