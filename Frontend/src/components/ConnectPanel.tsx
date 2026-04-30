import React, { useState, useEffect } from "react";
import { X, Copy, Check, ChevronLeft, Globe, Lock, AlertTriangle, Database, Box, Cable, CheckCircle2, ShieldOff } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useGetConnectionConfig } from "@/api/client";

type Method = "direct" | "framework" | "orm";
type Endpoint = "local" | "public";

const DEVICON = (name: string, variant = "original") =>
    `https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/${name}/${name}-${variant}.svg`;

type Framework = {
    id: string;
    name: string;
    iconUrl?: string;
    iconSvg?: string;
    install: string;
    files: (conn: string) => { name: string; content: string }[];
};

const TANSTACK_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#FF4154"/><text x="12" y="16" font-size="9" font-weight="bold" fill="white" text-anchor="middle" font-family="monospace">TQ</text></svg>`;

const FRAMEWORKS: Framework[] = [
    {
        id: "nextjs", name: "Next.js",
        iconUrl: DEVICON("nextjs", "plain"),
        install: "npm install pg",
        files: (c) => [
            { name: ".env.local", content: `DATABASE_URL="${c}"` },
            { name: "lib/db.ts", content: `import { Pool } from 'pg'\n\nconst pool = new Pool({\n  connectionString: process.env.DATABASE_URL,\n})\n\nexport default pool` },
        ],
    },
    {
        id: "remix", name: "Remix",
        iconUrl: DEVICON("remix", "original"),
        install: "npm install pg",
        files: (c) => [
            { name: ".env", content: `DATABASE_URL="${c}"` },
            { name: "app/db.server.ts", content: `import { Pool } from 'pg'\n\nconst pool = new Pool({\n  connectionString: process.env.DATABASE_URL,\n})\n\nexport { pool }` },
        ],
    },
    {
        id: "react", name: "React",
        iconUrl: DEVICON("react", "original"),
        install: "npm install pg",
        files: (c) => [
            { name: ".env", content: `REACT_APP_DATABASE_URL="${c}"` },
            { name: "src/db.js", content: `import { Pool } from 'pg'\n\nconst pool = new Pool({\n  connectionString: process.env.REACT_APP_DATABASE_URL,\n})\n\nexport default pool` },
        ],
    },
    {
        id: "nuxt", name: "Nuxt",
        iconUrl: DEVICON("nuxtjs", "original"),
        install: "npm install pg",
        files: (c) => [
            { name: ".env", content: `DATABASE_URL="${c}"` },
            { name: "server/db.ts", content: `import { Pool } from 'pg'\n\nconst pool = new Pool({\n  connectionString: process.env.DATABASE_URL,\n})\n\nexport { pool }` },
        ],
    },
    {
        id: "vue", name: "Vue",
        iconUrl: DEVICON("vuejs", "original"),
        install: "npm install pg",
        files: (c) => [
            { name: ".env", content: `VUE_APP_DATABASE_URL="${c}"` },
            { name: "src/db.js", content: `import { Pool } from 'pg'\n\nconst pool = new Pool({\n  connectionString: process.env.VUE_APP_DATABASE_URL,\n})\n\nexport default pool` },
        ],
    },
    {
        id: "solid", name: "Solid",
        iconUrl: DEVICON("solidjs", "original"),
        install: "npm install pg",
        files: (c) => [
            { name: ".env", content: `DATABASE_URL="${c}"` },
            { name: "src/db.ts", content: `import { Pool } from 'pg'\n\nconst pool = new Pool({\n  connectionString: import.meta.env.DATABASE_URL,\n})\n\nexport default pool` },
        ],
    },
    {
        id: "astro", name: "Astro",
        iconUrl: DEVICON("astro", "original"),
        install: "npm install pg",
        files: (c) => [
            { name: ".env", content: `DATABASE_URL="${c}"` },
            { name: "src/lib/db.ts", content: `import { Pool } from 'pg'\n\nconst pool = new Pool({\n  connectionString: import.meta.env.DATABASE_URL,\n})\n\nexport default pool` },
        ],
    },
    {
        id: "tanstack", name: "TanStack",
        iconSvg: TANSTACK_SVG,
        install: "npm install pg",
        files: (c) => [
            { name: ".env", content: `DATABASE_URL="${c}"` },
            { name: "app/db.ts", content: `import { Pool } from 'pg'\n\nconst pool = new Pool({\n  connectionString: process.env.DATABASE_URL,\n})\n\nexport { pool }` },
        ],
    },
    {
        id: "flask", name: "Flask",
        iconUrl: DEVICON("flask", "original"),
        install: "pip install psycopg2-binary python-dotenv",
        files: (c) => [
            { name: ".env", content: `DATABASE_URL="${c}"` },
            { name: "db.py", content: `import psycopg2\nfrom dotenv import load_dotenv\nimport os\n\nload_dotenv()\n\ndef get_conn():\n    return psycopg2.connect(os.getenv("DATABASE_URL"))` },
        ],
    },
    {
        id: "flutter", name: "Flutter",
        iconUrl: DEVICON("flutter", "original"),
        install: "# Add to pubspec.yaml:\n# postgres: ^3.0.0",
        files: (c) => [
            { name: "pubspec.yaml", content: `dependencies:\n  postgres: ^3.0.0` },
            { name: "lib/db.dart", content: `import 'package:postgres/postgres.dart';\n\nfinal conn = await Connection.open(\n  Endpoint(\n    host: '127.0.0.1',\n    database: 'postgres',\n    username: 'postgres',\n    password: '[YOUR-PASSWORD]',\n  ),\n);` },
        ],
    },
    {
        id: "reactnative", name: "React Native",
        iconUrl: DEVICON("react", "original"),
        install: "npm install axios",
        files: (c) => [
            { name: ".env", content: `API_URL="https://your-api.example.com"` },
            { name: "src/api/db.ts", content: `// React Native cannot connect to PostgreSQL directly.\n// Use a backend API or serverless function instead.\n\nimport axios from 'axios';\n\nconst api = axios.create({\n  baseURL: process.env.API_URL,\n});\n\nexport default api;` },
        ],
    },
];

const ORMS = [
    {
        id: "prisma", name: "Prisma",
        iconUrl: DEVICON("prisma", "original"),
        install: "npm install prisma --save-dev\nnpx prisma init",
        files: (c: string) => [
            { name: ".env", content: `DATABASE_URL="${c}"` },
            { name: "prisma/schema.prisma", content: `datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n\ngenerator client {\n  provider = "prisma-client-js"\n}` },
        ],
    },
    {
        id: "drizzle", name: "Drizzle",
        iconUrl: "https://orm.drizzle.team/favicon.ico",
        install: "npm install drizzle-orm pg\nnpm install -D drizzle-kit",
        files: (c: string) => [
            { name: ".env", content: `DATABASE_URL="${c}"` },
            { name: "drizzle.config.ts", content: `import { defineConfig } from "drizzle-kit";\n\nexport default defineConfig({\n  dialect: "postgresql",\n  dbCredentials: { url: process.env.DATABASE_URL! },\n});` },
            { name: "src/db.ts", content: `import { drizzle } from 'drizzle-orm/node-postgres';\nimport { Pool } from 'pg';\n\nconst pool = new Pool({\n  connectionString: process.env.DATABASE_URL,\n});\n\nexport const db = drizzle(pool);` },
        ],
    },
];

function CopyBtn({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            onClick={() => {
                navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
            }}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
        >
            {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
    );
}

function EndpointToggle({ endpoint, setEndpoint }: { endpoint: Endpoint; setEndpoint: (e: Endpoint) => void }) {
    return (
        <div className="flex items-center self-start border border-border rounded-lg overflow-hidden">
            {(["local", "public"] as Endpoint[]).map((ep) => (
                <button
                    key={ep}
                    onClick={() => setEndpoint(ep)}
                    className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all",
                        ep === endpoint
                            ? "bg-[#f3f3f3] dark:bg-muted/60 text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        ep === "local" ? "border-r border-border" : ""
                    )}
                >
                    {ep === "local" ? <Lock className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                    {ep === "local" ? "Local" : "Public"}
                </button>
            ))}
        </div>
    );
}

function PublicNotExposed({ onClose }: { onClose?: () => void }) {
    return (
        <div className="flex gap-3 px-4 py-3 rounded-lg border border-amber-400/30 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20">
            <ShieldOff className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1 min-w-0">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-300 leading-relaxed">
                    Your connection is not exposed publicly.
                </p>
                <p className="text-[11px] text-amber-700/80 dark:text-amber-400/70 leading-relaxed">
                    Public connections won't work until <strong>Expose Public</strong> is enabled. Go to{" "}
                    <Link
                        href="/settings"
                        onClick={onClose}
                        className="font-semibold text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
                    >
                        Settings
                    </Link>
                    {" "}and enable <span className="font-semibold">Expose Public</span> under the connection section.
                </p>
            </div>
        </div>
    );
}

function PublicExposed({ onClose }: { onClose?: () => void }) {
    return (
        <div className="flex gap-3 px-4 py-3 rounded-lg border border-emerald-400/30 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/20">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1 min-w-0">
                <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300 leading-relaxed">
                    Public access is active.
                </p>
                <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/70 leading-relaxed">
                    Your database is publicly reachable. You can{" "}
                    <Link
                        href="/settings"
                        onClick={onClose}
                        className="font-semibold text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
                    >
                        remove public access
                    </Link>
                    {" "}from Settings at any time.
                </p>
            </div>
        </div>
    );
}

function CodeBox({ code }: { code: string }) {
    return (
        <div className="relative group rounded-lg border border-border bg-muted/20 overflow-hidden">
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <CopyBtn text={code} />
            </div>
            <pre className="text-[11px] font-mono text-foreground leading-relaxed px-4 py-3 overflow-x-auto whitespace-pre-wrap break-all">{code}</pre>
        </div>
    );
}

function ConnStringBox({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{label}</span>
            <div className="flex items-center gap-2 bg-muted/20 border border-border rounded-lg px-3 py-2">
                <span className="text-[11px] font-mono text-foreground flex-1 break-all leading-relaxed">{value}</span>
                <CopyBtn text={value} />
            </div>
        </div>
    );
}

function StepLabel({ number, title }: { number: number; title: string }) {
    return (
        <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full border border-primary/30 bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">{number}</span>
            <span className="text-xs font-semibold text-foreground">{title}</span>
        </div>
    );
}

function FileTabs({ files }: { files: { name: string; content: string }[] }) {
    const [active, setActive] = useState(0);
    return (
        <div className="rounded-lg border border-border overflow-hidden">
            <div className="flex border-b border-border bg-muted/30">
                {files.map((f, i) => (
                    <button
                        key={f.name}
                        onClick={() => setActive(i)}
                        className={cn(
                            "px-3 py-2 text-[11px] font-mono transition-colors border-r border-border last:border-r-0",
                            active === i ? "bg-[#f3f3f3] dark:bg-muted/60 text-foreground" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {f.name}
                    </button>
                ))}
            </div>
            <div className="relative group bg-background">
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <CopyBtn text={files[active].content} />
                </div>
                <pre className="text-[11px] font-mono text-foreground leading-relaxed px-4 py-3 overflow-x-auto whitespace-pre-wrap break-all">{files[active].content}</pre>
            </div>
        </div>
    );
}

function DevIcon({ fw }: { fw: Framework | (typeof ORMS)[0] }) {
    const [err, setErr] = useState(false);
    const f = fw as Framework;
    if (f.iconSvg && !err) {
        return <img src={`data:image/svg+xml;utf8,${encodeURIComponent(f.iconSvg)}`} className="w-8 h-8 object-contain" alt={fw.name} />;
    }
    if (fw.iconUrl && !err) {
        return <img src={fw.iconUrl} className="w-8 h-8 object-contain" alt={fw.name} onError={() => setErr(true)} />;
    }
    return (
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary">
            {fw.name.slice(0, 2).toUpperCase()}
        </div>
    );
}

interface ContentProps {
    onClose?: () => void;
    localDirect: string;
    localPooler: string;
    publicDirect: string;
    publicPooler: string;
    exposed: boolean;
    loading: boolean;
}

function DirectContent({ onClose, localDirect, localPooler, publicDirect, publicPooler, exposed, loading }: ContentProps) {
    const [endpoint, setEndpoint] = useState<Endpoint>("local");
    const isPublic = endpoint === "public";

    return (
        <div className="flex flex-col gap-5">
            <EndpointToggle endpoint={endpoint} setEndpoint={setEndpoint} />

            {isPublic && !exposed && <PublicNotExposed onClose={onClose} />}
            {isPublic && exposed && <PublicExposed onClose={onClose} />}

            {(!isPublic || exposed) && (
                <div className="flex flex-col gap-3">
                    {loading ? (
                        <div className="h-24 bg-muted/20 rounded-xl animate-pulse border border-border" />
                    ) : (
                        <>
                            <div className="flex flex-col gap-3 border border-border rounded-xl p-4 bg-background">
                                <span className="text-xs font-semibold text-foreground">Direct Connection</span>
                                <ConnStringBox
                                    label={isPublic ? "Public" : "Local"}
                                    value={isPublic ? publicDirect : localDirect}
                                />
                            </div>
                            <div className="flex flex-col gap-3 border border-border rounded-xl p-4 bg-background">
                                <span className="text-xs font-semibold text-foreground">PGBouncer Connection</span>
                                <ConnStringBox
                                    label={isPublic ? "Public" : "Local"}
                                    value={isPublic ? publicPooler : localPooler}
                                />
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

function FrameworkContent({ onClose, localDirect, publicDirect, exposed, loading }: ContentProps) {
    const [selected, setSelected] = useState<string | null>(null);
    const [endpoint, setEndpoint] = useState<Endpoint>("local");
    const fw = FRAMEWORKS.find((f) => f.id === selected);
    const isPublic = endpoint === "public";
    const connStr = isPublic ? publicDirect : localDirect;

    if (!selected) {
        return (
            <div className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground">Select a framework to get a tailored connection setup.</p>
                <div className="grid grid-cols-4 gap-2">
                    {FRAMEWORKS.map((f) => (
                        <button
                            key={f.id}
                            onClick={() => setSelected(f.id)}
                            className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border bg-background hover:border-primary/40 hover:bg-[#f3f3f3] dark:hover:bg-muted/40 transition-all group"
                        >
                            <DevIcon fw={f} />
                            <span className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground leading-tight text-center">{f.name}</span>
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2">
                <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <ChevronLeft className="w-3.5 h-3.5" />Back
                </button>
                <div className="w-px h-4 bg-border" />
                <div className="flex items-center gap-1.5">
                    <DevIcon fw={fw!} />
                    <span className="text-xs font-semibold text-foreground">{fw?.name}</span>
                </div>
            </div>
            <EndpointToggle endpoint={endpoint} setEndpoint={setEndpoint} />
            {isPublic && !exposed && <PublicNotExposed onClose={onClose} />}
            {isPublic && exposed && <PublicExposed onClose={onClose} />}
            {(!isPublic || exposed) && !loading && (
                <>
                    <div className="flex flex-col gap-2">
                        <StepLabel number={1} title="Install package" />
                        <p className="text-[11px] text-muted-foreground pl-7">Run this command to install the required dependencies.</p>
                        <div className="pl-7"><CodeBox code={fw!.install} /></div>
                    </div>
                    <div className="flex flex-col gap-2">
                        <StepLabel number={2} title="Add files" />
                        <p className="text-[11px] text-muted-foreground pl-7">Copy the following code into your project.</p>
                        <div className="pl-7"><FileTabs files={fw!.files(connStr)} /></div>
                    </div>
                </>
            )}
        </div>
    );
}

function OrmContent({ onClose, localDirect, publicDirect, exposed, loading }: ContentProps) {
    const [selected, setSelected] = useState<string | null>(null);
    const [endpoint, setEndpoint] = useState<Endpoint>("local");
    const orm = ORMS.find((o) => o.id === selected);
    const isPublic = endpoint === "public";
    const connStr = isPublic ? publicDirect : localDirect;

    if (!selected) {
        return (
            <div className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground">Select an ORM to get a tailored configuration.</p>
                <div className="grid grid-cols-2 gap-3">
                    {ORMS.map((o) => (
                        <button
                            key={o.id}
                            onClick={() => setSelected(o.id)}
                            className="flex flex-col items-center gap-2.5 p-5 rounded-xl border border-border bg-background hover:border-primary/40 hover:bg-[#f3f3f3] dark:hover:bg-muted/40 transition-all group"
                        >
                            <DevIcon fw={o as any} />
                            <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground">{o.name}</span>
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2">
                <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <ChevronLeft className="w-3.5 h-3.5" />Back
                </button>
                <div className="w-px h-4 bg-border" />
                <div className="flex items-center gap-1.5">
                    <DevIcon fw={orm as any} />
                    <span className="text-xs font-semibold text-foreground">{orm?.name}</span>
                </div>
            </div>
            <EndpointToggle endpoint={endpoint} setEndpoint={setEndpoint} />
            {isPublic && !exposed && <PublicNotExposed onClose={onClose} />}
            {isPublic && exposed && <PublicExposed onClose={onClose} />}
            {(!isPublic || exposed) && !loading && (
                <>
                    <div className="flex flex-col gap-2">
                        <StepLabel number={1} title="Install ORM" />
                        <p className="text-[11px] text-muted-foreground pl-7">Add the ORM to your project.</p>
                        <div className="pl-7"><CodeBox code={orm!.install} /></div>
                    </div>
                    <div className="flex flex-col gap-2">
                        <StepLabel number={2} title="Configure ORM" />
                        <p className="text-[11px] text-muted-foreground pl-7">Set up your ORM configuration.</p>
                        <div className="pl-7"><FileTabs files={orm!.files(connStr)} /></div>
                    </div>
                </>
            )}
        </div>
    );
}

interface ConnectPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ConnectPanel({ isOpen, onClose }: ConnectPanelProps) {
    const [method, setMethod] = useState<Method>("direct");
    const { data: cfg, isLoading } = useGetConnectionConfig();

    const exposed = cfg?.exposed ?? false;
    const localDirect = cfg?.directLocal ?? "";
    const localPooler = cfg?.poolerLocal ?? "";
    const publicDirect = cfg?.directPublic ?? "";
    const publicPooler = cfg?.poolerPublic ?? "";

    useEffect(() => {
        document.body.style.overflow = isOpen ? "hidden" : "";
        return () => { document.body.style.overflow = ""; };
    }, [isOpen]);

    const methods: { id: Method; label: string; sub: string; icon: any }[] = [
        { id: "direct", label: "Direct", sub: "Connection string", icon: Database },
        { id: "framework", label: "Framework", sub: "Use a client library", icon: Box },
        { id: "orm", label: "ORM", sub: "Third-party library", icon: Cable },
    ];

    const contentProps: ContentProps = {
        onClose,
        localDirect,
        localPooler,
        publicDirect,
        publicPooler,
        exposed,
        loading: isLoading,
    };

    return (
        <>
            <div
                className={cn(
                    "fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity duration-300",
                    isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                )}
                onClick={onClose}
            />
            <div
                className={cn(
                    "fixed top-0 right-0 z-50 h-full w-full sm:w-[60vw] sm:min-w-[580px] sm:max-w-[780px] border-l border-border flex flex-col transition-transform duration-300 ease-in-out",
                    isOpen ? "translate-x-0" : "translate-x-full"
                )}
                style={{ backgroundColor: "var(--panel-bg, #f8f8f8)" }}
            >
                <style>{`
                    :root { --panel-bg: #f8f8f8; }
                    .dark { --panel-bg: hsl(var(--background)); }
                `}</style>

                <div className="flex items-center justify-between px-6 py-5 border-b border-border shrink-0">
                    <div className="flex flex-col gap-1">
                        <h2 className="text-base font-semibold text-foreground">Connect to Database</h2>
                        <p className="text-xs text-muted-foreground">Get connection details for your app</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="px-6 pt-4 pb-2 shrink-0">
                    <div className="flex rounded-lg border border-border overflow-hidden">
                        {methods.map((m, i) => (
                            <button
                                key={m.id}
                                onClick={() => setMethod(m.id)}
                                className={cn(
                                    "flex-1 flex flex-col items-start px-6 py-5 text-left transition-colors",
                                    i < methods.length - 1 ? "border-r border-border" : "",
                                    method === m.id ? "bg-[#f3f3f3] dark:bg-muted/40" : "hover:bg-black/[0.03] dark:hover:bg-white/5"
                                )}
                            >
                                <m.icon className={cn("w-4 h-4 mb-3", method === m.id ? "text-primary" : "text-muted-foreground")} strokeWidth={1.5} />
                                <span className={cn("text-sm font-semibold leading-tight", method === m.id ? "text-foreground" : "text-muted-foreground")}>{m.label}</span>
                                <span className="text-[11px] text-muted-foreground/70 mt-0.5">{m.sub}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                    {method === "direct" && <DirectContent {...contentProps} />}
                    {method === "framework" && <FrameworkContent {...contentProps} />}
                    {method === "orm" && <OrmContent {...contentProps} />}
                </div>
            </div>
        </>
    );
}
