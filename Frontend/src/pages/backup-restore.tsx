import React, { useState, useRef } from "react";
import { DesktopSidebar, MobileSidebarTrigger, IconBackupRestore } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Sun, Moon, HardDrive, Download, RefreshCw, Clock,
    Upload, FileText, FileSpreadsheet, X, CheckCircle2, AlertCircle, Trash2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { useGetBackups, createBackup, getBackupDownloadUrl, deleteBackup, restoreSql, type Backup } from "@/api/client";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

type UploadedFile = {
    id: string;
    name: string;
    size: string;
    rawContent: string;
    type: "sql" | "csv";
    status: "pending" | "uploading" | "done" | "error";
    error?: string;
};

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function BackupTab() {
    const { data: backups, isLoading, refetch } = useGetBackups();
    const queryClient = useQueryClient();
    const [creating, setCreating] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const handleBackup = async () => {
        setCreating(true);
        try {
            await createBackup();
            await queryClient.invalidateQueries({ queryKey: ["admin-backups"] });
            toast.custom((t) => (
                <Alert variant="success" title="Backup Created" description="Your database backup has been created successfully." onClose={() => toast.dismiss(t)} />
            ));
        } catch (err: any) {
            toast.custom((t) => (
                <Alert variant="error" title="Backup Failed" description={err.message} onClose={() => toast.dismiss(t)} />
            ));
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (id: string) => {
        setDeletingId(id);
        try {
            await deleteBackup(id);
            await queryClient.invalidateQueries({ queryKey: ["admin-backups"] });
            toast.custom((t) => (
                <Alert variant="info" title="Backup Deleted" description="The backup has been removed." onClose={() => toast.dismiss(t)} />
            ));
        } catch (err: any) {
            toast.custom((t) => (
                <Alert variant="error" title="Delete Failed" description={err.message} onClose={() => toast.dismiss(t)} />
            ));
        } finally {
            setDeletingId(null);
        }
    };

    const handleDownload = (backup: Backup) => {
        const token = localStorage.getItem("nextbase_token");
        fetch(getBackupDownloadUrl(backup.id), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
            .then(r => r.blob())
            .then(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = backup.filename;
                a.click();
                URL.revokeObjectURL(url);
            })
            .catch(err => toast.custom((t) => (<Alert variant="error" title="Download Failed" description={err.message} onClose={() => toast.dismiss(t)} />)));
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="border border-border rounded-xl bg-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20"><HardDrive className="w-3.5 h-3.5 text-primary" /></div>
                        <span className="text-sm font-semibold text-foreground">Backup Database</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs gap-1" onClick={() => refetch()}>
                            <RefreshCw className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 px-3 text-xs font-medium gap-1.5" onClick={handleBackup} disabled={creating}>
                            {creating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                            {creating ? "Creating..." : "Create Backup"}
                        </Button>
                    </div>
                </div>
                <div className="px-5 py-3 border-b border-border bg-muted/10">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        Backups are created using <span className="font-mono font-semibold text-foreground">pg_dump</span> and stored on the server. Click Create Backup to generate a new snapshot.
                    </p>
                </div>
                <div className="flex flex-col divide-y divide-border">
                    {isLoading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                                <Skeleton className="w-7 h-7 rounded-md bg-muted" />
                                <div className="flex-1"><Skeleton className="h-3 w-32 bg-muted mb-1.5" /><Skeleton className="h-3 w-20 bg-muted" /></div>
                                <Skeleton className="h-5 w-14 bg-muted rounded" />
                            </div>
                        ))
                    ) : !backups || backups.length === 0 ? (
                        <div className="py-10 text-center text-sm text-muted-foreground">No backups yet. Click "Create Backup" to get started.</div>
                    ) : (
                        backups.map((bk) => (
                            <div key={bk.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/20 transition-colors group">
                                <div className="p-1.5 rounded-md bg-muted/50 border border-border/60 shrink-0"><HardDrive className="w-3.5 h-3.5 text-muted-foreground" /></div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-foreground">{bk.label}</p>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <Clock className="w-2.5 h-2.5 text-muted-foreground/60" />
                                        <p className="text-[10px] text-muted-foreground font-mono">{format(new Date(bk.time), "MMM d, yyyy 'at' HH:mm")}</p>
                                    </div>
                                </div>
                                <span className="text-[10px] text-muted-foreground font-mono shrink-0 px-2 py-0.5 bg-muted/40 rounded border border-border/60">{bk.size}</span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="w-1.5 h-1.5 rounded-full bg-primary/70" />
                                    <span className="text-[10px] text-primary font-semibold">Ready</span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => handleDownload(bk)}>
                                        <Download className="w-3 h-3 mr-1" />Download
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(bk.id)} disabled={deletingId === bk.id}>
                                        {deletingId === bk.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                    </Button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

function RestoreTab() {
    const inputRef = useRef<HTMLInputElement>(null);
    const [files, setFiles] = useState<UploadedFile[]>([]);
    const [dragging, setDragging] = useState(false);

    const readFile = (f: File): Promise<string> => new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = e => res(e.target?.result as string);
        reader.onerror = rej;
        reader.readAsText(f);
    });

    const processFiles = async (rawFiles: FileList | null) => {
        if (!rawFiles) return;
        const allowed = Array.from(rawFiles).filter(f => {
            const ext = f.name.split(".").pop()?.toLowerCase();
            return ext === "sql" || ext === "csv";
        });
        if (allowed.length === 0) {
            toast.custom((t) => (<Alert variant="warning" title="Invalid File Type" description="Only .sql and .csv files are supported." onClose={() => toast.dismiss(t)} />));
            return;
        }
        const newFiles: UploadedFile[] = await Promise.all(allowed.map(async f => ({
            id: `${Date.now()}_${f.name}`,
            name: f.name,
            size: formatFileSize(f.size),
            rawContent: await readFile(f),
            type: f.name.endsWith(".sql") ? "sql" as const : "csv" as const,
            status: "pending" as const,
        })));
        setFiles(prev => [...prev, ...newFiles]);
    };

    const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); processFiles(e.dataTransfer.files); };

    const handleRestore = async (fileId: string) => {
        const file = files.find(f => f.id === fileId);
        if (!file) return;
        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: "uploading" } : f));
        try {
            const result = await restoreSql(file.rawContent);
            setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: "done" } : f));
            toast.custom((t) => (<Alert variant="success" title="Restore Complete" description={`Executed ${result.executed} statement(s). ${result.errors.length > 0 ? `${result.errors.length} error(s).` : ""}` } onClose={() => toast.dismiss(t)} />));
        } catch (err: any) {
            setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: "error", error: err.message } : f));
            toast.custom((t) => (<Alert variant="error" title="Restore Failed" description={err.message} onClose={() => toast.dismiss(t)} />));
        }
    };

    const removeFile = (fileId: string) => setFiles(prev => prev.filter(f => f.id !== fileId));

    return (
        <div className="flex flex-col gap-6">
            <div className="border border-border rounded-xl bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-border bg-muted/20">
                    <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20"><Upload className="w-3.5 h-3.5 text-primary" /></div>
                    <span className="text-sm font-semibold text-foreground">Restore from File</span>
                </div>
                <div className="p-5 flex flex-col gap-4">
                    <p className="text-xs text-muted-foreground leading-relaxed">Upload a <span className="font-mono font-semibold text-foreground">.sql</span> file to restore. SQL files are executed statement by statement against your database.</p>
                    <div className={cn("border-2 border-dashed rounded-xl px-6 py-10 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer", dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30")} onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
                        <div className="p-3 rounded-full bg-muted border border-border"><Upload className="w-5 h-5 text-muted-foreground" /></div>
                        <div className="text-center">
                            <p className="text-sm font-medium text-foreground">Drop files here or click to upload</p>
                            <p className="text-xs text-muted-foreground mt-1">Supports .sql files</p>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/50 border border-border">
                                <FileText className="w-3.5 h-3.5 text-blue-400" /><span className="text-[11px] font-mono text-muted-foreground">.sql</span>
                            </div>
                        </div>
                        <input ref={inputRef} type="file" accept=".sql" multiple className="hidden" onChange={(e) => processFiles(e.target.files)} />
                    </div>
                    {files.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Queued Files</p>
                            <div className="flex flex-col divide-y divide-border border border-border rounded-xl overflow-hidden">
                                {files.map((file) => (
                                    <div key={file.id} className="flex items-center gap-3 px-4 py-3">
                                        <div className="shrink-0"><FileText className="w-4 h-4 text-blue-400" /></div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-semibold text-foreground truncate">{file.name}</p>
                                            <p className="text-[10px] text-muted-foreground font-mono">{file.size}</p>
                                        </div>
                                        {file.status === "done" ? (
                                            <div className="flex items-center gap-1.5 shrink-0"><CheckCircle2 className="w-3.5 h-3.5 text-primary" /><span className="text-[10px] text-primary font-semibold">Restored</span></div>
                                        ) : file.status === "error" ? (
                                            <div className="flex items-center gap-1.5 shrink-0"><AlertCircle className="w-3.5 h-3.5 text-destructive" /><span className="text-[10px] text-destructive font-semibold">Failed</span></div>
                                        ) : file.status === "uploading" ? (
                                            <div className="flex items-center gap-1.5 shrink-0"><RefreshCw className="w-3.5 h-3.5 text-primary animate-spin" /><span className="text-[10px] text-primary font-semibold">Restoring...</span></div>
                                        ) : (
                                            <div className="flex items-center gap-2 shrink-0">
                                                <Button size="sm" variant="outline" className="h-7 px-3 text-xs gap-1" onClick={() => handleRestore(file.id)}>
                                                    <Upload className="w-3 h-3" />Restore
                                                </Button>
                                                <button onClick={() => removeFile(file.id)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"><X className="w-3.5 h-3.5" /></button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function BackupRestorePage() {
    const { theme, toggle } = useTheme();
    const [activeTab, setActiveTab] = useState<"backup" | "restore">("backup");

    return (
        <div className="min-h-screen bg-background text-foreground flex">
            <DesktopSidebar />
            <div className="flex-1 flex flex-col min-w-0">
                <header className="h-18 border-b border-border bg-background flex items-center justify-between px-6 shrink-0 sticky top-0 z-10">
                    <div className="flex items-center gap-4">
                        <MobileSidebarTrigger />
                        <div className="flex items-center gap-2">
                            <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0"><IconBackupRestore className="w-4 h-4 text-primary" /></div>
                            <h1 className="text-sm font-semibold tracking-tight">Backup & Restore</h1>
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60" onClick={toggle} aria-label="Toggle theme">
                        {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </Button>
                </header>
                <div className="px-6 pt-8 max-w-3xl w-full mx-auto flex flex-col gap-6 flex-1">
                    <div>
                        <h2 className="text-xl font-bold text-foreground tracking-tight">Backup & Restore</h2>
                        <p className="text-sm text-muted-foreground mt-1">Manage database backups and restore from a file.</p>
                    </div>
                    <div className="flex items-center gap-1 border-b border-border">
                        {(["backup", "restore"] as const).map((tab) => (
                            <button key={tab} onClick={() => setActiveTab(tab)} className={cn("relative px-4 py-2 text-sm font-medium transition-colors capitalize", activeTab === tab ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                {tab === "backup" ? "Backup" : "Restore"}
                                {activeTab === tab && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
                            </button>
                        ))}
                    </div>
                    <div className="pb-10">{activeTab === "backup" ? <BackupTab /> : <RestoreTab />}</div>
                </div>
            </div>
        </div>
    );
}
