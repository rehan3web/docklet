import React, { useState, useRef, useCallback, useEffect } from "react";
import { Sun, Moon, Database, Plus, Trash2, RefreshCw, Upload, Download, Pencil, Search, X, FolderOpen, File, FileText, FileImage, FileCode, Archive, CheckSquare, Square, ChevronRight, Loader2, Unplug, Link2, Container, Zap, CheckCircle2, Circle } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetStorageConnection, useGetStorageBuckets, useGetStorageFiles,
  useGetStorageInstance,
  storageConnect, storageDisconnect, storageCreateBucket, storageDeleteBucket,
  storageDeleteFiles, storageRenameFile, storageDownloadUrl, storageUploadFile,
  storageCreateInstance, storageDestroyInstance,
  type StorageBucket, type StorageFile,
} from "@/api/client";

// ── helpers ───────────────────────────────────────────────────────────────────
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function fileIcon(key: string) {
  const ext = key.split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "ico"].includes(ext)) return <FileImage className="w-4 h-4 text-blue-400 shrink-0" />;
  if (["txt", "md", "csv", "log"].includes(ext)) return <FileText className="w-4 h-4 text-muted-foreground shrink-0" />;
  if (["json", "yaml", "yml", "ts", "tsx", "js", "jsx", "html", "css", "py", "go", "rs"].includes(ext)) return <FileCode className="w-4 h-4 text-amber-400 shrink-0" />;
  if (["zip", "tar", "gz", "bz2", "7z", "rar"].includes(ext)) return <Archive className="w-4 h-4 text-purple-400 shrink-0" />;
  return <File className="w-4 h-4 text-muted-foreground shrink-0" />;
}

// ── Connect Dialog ────────────────────────────────────────────────────────────
function ConnectDialog({ open, onClose, onConnected }: { open: boolean; onClose: () => void; onConnected: () => void }) {
  const [endpoint, setEndpoint] = useState("");
  const [port, setPort] = useState("9000");
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [useSsl, setUseSsl] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await storageConnect({ endpoint, port: parseInt(port) || 9000, access_key: accessKey, secret_key: secretKey, region, use_ssl: useSsl });
      toast.success("Connected to MinIO successfully");
      onConnected();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Connection failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <Link2 className="w-4 h-4 text-muted-foreground" /> Connect to MinIO
          </DialogTitle>
          <DialogDescription className="text-xs">Configure your MinIO / S3-compatible endpoint.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 pt-1">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Endpoint</Label>
              <Input placeholder="minio.example.com or IP" value={endpoint} onChange={e => setEndpoint(e.target.value)} className="h-8 text-xs" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Port</Label>
              <Input placeholder="9000" value={port} onChange={e => setPort(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Access Key</Label>
              <Input placeholder="minioadmin" value={accessKey} onChange={e => setAccessKey(e.target.value)} className="h-8 text-xs" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Secret Key</Label>
              <Input type="password" placeholder="minioadmin" value={secretKey} onChange={e => setSecretKey(e.target.value)} className="h-8 text-xs" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">Region</Label>
              <Input placeholder="us-east-1" value={region} onChange={e => setRegion(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="flex items-center gap-2 pb-0.5">
              <Switch checked={useSsl} onCheckedChange={setUseSsl} id="ssl" />
              <Label htmlFor="ssl" className="text-xs cursor-pointer">Use SSL</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={busy} className="h-8 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none">
              {busy ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Connecting…</> : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Instance Dialog ────────────────────────────────────────────────────
type CreateStep = { label: string; status: "pending" | "active" | "done" | "error" };

function CreateInstanceDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [accessKey, setAccessKey] = useState("minioadmin");
  const [secretKey, setSecretKey] = useState("minioadmin123");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<CreateStep[]>([
    { label: "Pull MinIO image", status: "pending" },
    { label: "Create & start container", status: "pending" },
    { label: "Wait for MinIO to be ready", status: "pending" },
    { label: "Connect storage", status: "pending" },
  ]);
  const [errorMsg, setErrorMsg] = useState("");

  function setStep(idx: number, status: CreateStep["status"]) {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, status } : i < idx ? { ...s, status: "done" } : s));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (secretKey.length < 8) { toast.error("Secret key must be at least 8 characters"); return; }
    setBusy(true);
    setErrorMsg("");
    setSteps(steps.map((s, i) => ({ ...s, status: i === 0 ? "active" : "pending" })));

    // Animate steps while backend processes
    const ticker = setInterval(() => {
      setSteps(prev => {
        const activeIdx = prev.findIndex(s => s.status === "active");
        if (activeIdx === -1 || activeIdx >= prev.length - 1) return prev;
        // advance roughly every 8s
        return prev;
      });
    }, 500);

    // Simulate step progression while request is in flight
    let stepIdx = 0;
    const advance = () => {
      stepIdx = Math.min(stepIdx + 1, 3);
      setStep(stepIdx, "active");
    };
    const t1 = setTimeout(advance, 8000);   // image pull done
    const t2 = setTimeout(advance, 12000);  // container started
    const t3 = setTimeout(advance, 14000);  // waiting

    try {
      await storageCreateInstance(accessKey, secretKey);
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearInterval(ticker);
      setSteps(s => s.map(x => ({ ...x, status: "done" })));
      await new Promise(r => setTimeout(r, 600));
      toast.success("MinIO instance created and connected");
      onCreated();
      onClose();
    } catch (err: any) {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearInterval(ticker);
      setSteps(prev => prev.map((s, i) => s.status === "active" ? { ...s, status: "error" } : s));
      setErrorMsg(err.message || "Failed to create instance");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setBusy(false);
    setErrorMsg("");
    setSteps([
      { label: "Pull MinIO image", status: "pending" },
      { label: "Create & start container", status: "pending" },
      { label: "Wait for MinIO to be ready", status: "pending" },
      { label: "Connect storage", status: "pending" },
    ]);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <Container className="w-4 h-4 text-muted-foreground" /> Create MinIO Instance
          </DialogTitle>
          <DialogDescription className="text-xs">
            A MinIO Docker container (<code className="font-mono bg-muted px-1 rounded">docklet-minio</code>) will be created on port 9000 and auto-connected.
          </DialogDescription>
        </DialogHeader>

        {!busy ? (
          <form onSubmit={create} className="space-y-4 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Username (Access Key)</Label>
                <Input value={accessKey} onChange={e => setAccessKey(e.target.value)} className="h-8 text-xs font-mono" required />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Password (Secret Key)</Label>
                <Input type="password" value={secretKey} onChange={e => setSecretKey(e.target.value)} className="h-8 text-xs font-mono" required />
                <p className="text-[10px] text-muted-foreground">Min 8 characters</p>
              </div>
            </div>
            <div className="rounded-lg bg-muted/40 border border-border px-3 py-2.5 text-xs text-muted-foreground space-y-1">
              <div className="flex items-center gap-1.5"><Zap className="w-3 h-3 text-primary" /><span>Ports <strong className="text-foreground">9000</strong> (API) and <strong className="text-foreground">9001</strong> (Console) will be bound on the host</span></div>
              <div className="flex items-center gap-1.5"><Database className="w-3 h-3 text-primary" /><span>Data persisted at <code className="font-mono">/var/lib/docklet/minio-data</code></span></div>
            </div>
            {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Cancel</Button>
              <Button type="submit" size="sm" className="h-8 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none">
                Create Instance
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="py-2 space-y-3">
            <p className="text-xs text-muted-foreground">This may take a minute while the image is pulled and MinIO starts up.</p>
            <div className="space-y-2.5">
              {steps.map((s, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  {s.status === "done" && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                  {s.status === "active" && <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />}
                  {s.status === "pending" && <Circle className="w-4 h-4 text-muted-foreground/30 shrink-0" />}
                  {s.status === "error" && <X className="w-4 h-4 text-destructive shrink-0" />}
                  <span className={`text-xs ${s.status === "active" ? "text-foreground font-medium" : s.status === "done" ? "text-muted-foreground line-through" : s.status === "error" ? "text-destructive" : "text-muted-foreground/50"}`}>
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
            {errorMsg && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">{errorMsg}</div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Upload Zone ───────────────────────────────────────────────────────────────
interface UploadState { file: File; progress: number; done: boolean; error?: string }

function UploadDialog({ bucket, open, onClose, onDone }: { bucket: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    setUploads(prev => [...prev, ...arr.map(f => ({ file: f, progress: 0, done: false }))]);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }

  async function startUpload() {
    for (let i = 0; i < uploads.length; i++) {
      if (uploads[i].done) continue;
      try {
        await storageUploadFile(bucket, uploads[i].file, uploads[i].file.name, (pct) => {
          setUploads(prev => prev.map((u, j) => j === i ? { ...u, progress: pct } : u));
        });
        setUploads(prev => prev.map((u, j) => j === i ? { ...u, progress: 100, done: true } : u));
      } catch (err: any) {
        setUploads(prev => prev.map((u, j) => j === i ? { ...u, error: err.message } : u));
      }
    }
    onDone();
  }

  const allDone = uploads.length > 0 && uploads.every(u => u.done || !!u.error);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setUploads([]); onClose(); } }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <Upload className="w-4 h-4 text-muted-foreground" /> Upload Files — {bucket}
          </DialogTitle>
        </DialogHeader>
        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Drop files here or <span className="text-primary underline underline-offset-2">click to browse</span></p>
          <p className="text-xs text-muted-foreground/60 mt-1">Max 200 MB per file</p>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); }} />
        </div>
        {uploads.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {uploads.map((u, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate max-w-[300px] text-foreground">{u.file.name}</span>
                  <span className={u.error ? "text-destructive" : "text-muted-foreground"}>{u.error ? "Failed" : u.done ? "Done" : `${u.progress}%`}</span>
                </div>
                <Progress value={u.progress} className={`h-1 ${u.error ? "[&>div]:bg-destructive" : ""}`} />
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setUploads([]); onClose(); }}>Cancel</Button>
          <Button size="sm" disabled={uploads.length === 0 || allDone} onClick={startUpload} className="h-8 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none">
            {allDone ? "Done" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Rename Dialog ─────────────────────────────────────────────────────────────
function RenameDialog({ bucket, file, open, onClose, onDone }: { bucket: string; file: StorageFile | null; open: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (file) setName(file.key.split("/").pop() || file.key); }, [file]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !name.trim()) return;
    setBusy(true);
    try {
      const prefix = file.key.includes("/") ? file.key.substring(0, file.key.lastIndexOf("/") + 1) : "";
      await storageRenameFile(bucket, file.key, prefix + name.trim());
      toast.success("File renamed");
      onDone();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Rename failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium">Rename File</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">New filename</Label>
            <Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-xs" autoFocus required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={busy} className="h-8 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function StoragePage() {
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const { data: conn, isLoading: connLoading } = useGetStorageConnection();
  const connected = conn?.connected === true;
  const { data: instance } = useGetStorageInstance();
  const isManaged = instance?.running === true;
  const { data: bucketsData, isLoading: bucketsLoading } = useGetStorageBuckets(connected);

  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: filesData, isLoading: filesLoading, refetch: refetchFiles } = useGetStorageFiles(selectedBucket);

  // Dialogs
  const [showConnect, setShowConnect] = useState(false);
  const [showCreateInstance, setShowCreateInstance] = useState(false);
  const [showCreateBucket, setShowCreateBucket] = useState(false);
  const [bucketName, setBucketName] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [renameFile, setRenameFile] = useState<StorageFile | null>(null);
  const [deleteBucket, setDeleteBucket] = useState<string | null>(null);
  const [deleteFiles, setDeleteFiles] = useState<string[]>([]);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["storage-buckets"] });
    qc.invalidateQueries({ queryKey: ["storage-files"] });
    qc.invalidateQueries({ queryKey: ["storage-connection"] });
  }

  async function handleDisconnect() {
    try {
      await storageDisconnect();
      setSelectedBucket(null);
      toast.success("Disconnected");
      refresh();
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleDestroyInstance() {
    try {
      await storageDestroyInstance();
      setSelectedBucket(null);
      toast.success("MinIO instance stopped and removed");
      refresh();
      qc.invalidateQueries({ queryKey: ["storage-instance"] });
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleCreateBucket(e: React.FormEvent) {
    e.preventDefault();
    if (!bucketName.trim()) return;
    try {
      await storageCreateBucket(bucketName.trim());
      toast.success(`Bucket "${bucketName}" created`);
      setBucketName("");
      setShowCreateBucket(false);
      qc.invalidateQueries({ queryKey: ["storage-buckets"] });
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleDeleteBucket() {
    if (!deleteBucket) return;
    try {
      await storageDeleteBucket(deleteBucket);
      toast.success(`Bucket "${deleteBucket}" deleted`);
      if (selectedBucket === deleteBucket) setSelectedBucket(null);
      setDeleteBucket(null);
      qc.invalidateQueries({ queryKey: ["storage-buckets"] });
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleDeleteFiles(keys?: string[]) {
    const targets = keys || Array.from(selected);
    if (!selectedBucket || !targets.length) return;
    try {
      await storageDeleteFiles(selectedBucket, targets);
      toast.success(`${targets.length} file(s) deleted`);
      setSelected(new Set());
      setDeleteFiles([]);
      refetchFiles();
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleDownload(file: StorageFile) {
    if (!selectedBucket) return;
    try {
      const { url } = await storageDownloadUrl(selectedBucket, file.key);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.key.split("/").pop() || file.key;
      a.target = "_blank";
      a.click();
    } catch (err: any) { toast.error(err.message); }
  }

  const files = (filesData?.files || []).filter(f => !search || f.key.toLowerCase().includes(search.toLowerCase()));
  const buckets = bucketsData?.buckets || [];

  const allSelected = files.length > 0 && files.every(f => selected.has(f.key));
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(files.map(f => f.key)));
  }
  function toggleFile(key: string) {
    setSelected(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <DesktopSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="px-4 h-18 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MobileSidebarTrigger />
              <div className="hidden lg:flex items-center gap-3">
                <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0">
                  <Database className="w-4 h-4 text-primary" />
                </div>
                <span className="font-medium text-sm tracking-tight">Storage</span>
                {connected && conn && (
                  <Badge variant="outline" className="font-mono text-[10px] rounded-full px-2 py-0 text-primary bg-primary/10 border-primary/20">
                    {conn.endpoint}:{conn.port}
                  </Badge>
                )}
                {isManaged && (
                  <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 text-emerald-600 bg-emerald-500/10 border-emerald-500/20 dark:text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block mr-1" />managed
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60" onClick={toggle}>
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
              <Button variant="outline" size="sm" className="h-8 rounded-full text-xs" onClick={refresh}>
                <RefreshCw className="w-3.5 h-3.5 mr-2" />Refresh
              </Button>
              {connected ? (
                isManaged ? (
                  <Button variant="outline" size="sm" className="h-8 rounded-full text-xs text-destructive border-destructive/30 hover:bg-destructive/10" onClick={handleDestroyInstance}>
                    <Trash2 className="w-3.5 h-3.5 mr-2" />Stop Instance
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="h-8 rounded-full text-xs text-destructive border-destructive/30 hover:bg-destructive/10" onClick={handleDisconnect}>
                    <Unplug className="w-3.5 h-3.5 mr-2" />Disconnect
                  </Button>
                )
              ) : (
                <Button size="sm" className="h-8 rounded-full text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none" onClick={() => setShowConnect(true)}>
                  <Link2 className="w-3.5 h-3.5 mr-2" />Connect
                </Button>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-8 pb-24 max-w-7xl w-full mx-auto">
          <div className="flex flex-col gap-2 mb-8">
            <h1 className="text-4xl sm:text-5xl font-normal tracking-tight text-foreground leading-none">Storage</h1>
            <p className="text-muted-foreground text-sm max-w-xl leading-relaxed">
              Manage MinIO buckets and files with a full S3-compatible interface.
            </p>
          </div>

          {/* Not connected */}
          {!connLoading && !connected && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
              {/* Create Instance card */}
              <Card className="bg-background border-border shadow-none rounded-xl flex flex-col hover:border-primary/30 transition-colors">
                <CardContent className="p-6 flex flex-col flex-1">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                    <Container className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="text-sm font-medium text-foreground mb-1">Create MinIO Instance</h3>
                  <p className="text-xs text-muted-foreground mb-5 leading-relaxed flex-1">
                    Launch a MinIO Docker container directly on this server. Set a username and password, and the panel handles the rest.
                  </p>
                  <div className="space-y-1.5 mb-5 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />Auto-pulls MinIO image</div>
                    <div className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />Port 9000 (API) + 9001 (Console)</div>
                    <div className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />Data persisted on disk</div>
                    <div className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />Auto-connects when ready</div>
                  </div>
                  <Button size="sm" className="h-8 text-xs w-full border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none" onClick={() => setShowCreateInstance(true)}>
                    <Container className="w-3.5 h-3.5 mr-2" />Create Instance
                  </Button>
                </CardContent>
              </Card>

              {/* Connect Existing card */}
              <Card className="bg-background border-border shadow-none rounded-xl flex flex-col hover:border-primary/30 transition-colors">
                <CardContent className="p-6 flex flex-col flex-1">
                  <div className="w-10 h-10 rounded-lg bg-muted border border-border flex items-center justify-center mb-4">
                    <Link2 className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <h3 className="text-sm font-medium text-foreground mb-1">Connect Existing</h3>
                  <p className="text-xs text-muted-foreground mb-5 leading-relaxed flex-1">
                    Connect to an already-running MinIO server or any S3-compatible endpoint (AWS S3, Backblaze B2, Cloudflare R2, etc.).
                  </p>
                  <div className="space-y-1.5 mb-5 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />Custom endpoint & port</div>
                    <div className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />SSL / HTTPS support</div>
                    <div className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />Any S3-compatible service</div>
                    <div className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />Test connection before saving</div>
                  </div>
                  <Button variant="outline" size="sm" className="h-8 text-xs w-full" onClick={() => setShowConnect(true)}>
                    <Link2 className="w-3.5 h-3.5 mr-2" />Connect to Existing
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Connected: split layout */}
          {connected && (
            <div className="flex gap-4 h-[calc(100vh-260px)] min-h-[500px]">
              {/* Bucket list */}
              <div className="w-56 shrink-0 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Buckets</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" title="New bucket" onClick={() => setShowCreateBucket(true)}>
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto space-y-0.5">
                  {bucketsLoading ? (
                    Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full rounded-lg bg-muted" />)
                  ) : buckets.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-xs text-muted-foreground">No buckets yet</p>
                      <button onClick={() => setShowCreateBucket(true)} className="text-xs text-primary underline underline-offset-2 mt-1">Create one</button>
                    </div>
                  ) : (
                    buckets.map(b => (
                      <div
                        key={b.name}
                        className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all ${selectedBucket === b.name ? "bg-muted text-foreground border border-border" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border border-transparent"}`}
                        onClick={() => { setSelectedBucket(b.name); setSelected(new Set()); setSearch(""); }}
                      >
                        <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-xs font-medium truncate flex-1">{b.name}</span>
                        <button
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-0.5 rounded"
                          onClick={e => { e.stopPropagation(); setDeleteBucket(b.name); }}
                          title="Delete bucket"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* File Explorer */}
              <div className="flex-1 flex flex-col border border-border rounded-xl overflow-hidden bg-background">
                {!selectedBucket ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                      <FolderOpen className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">Select a bucket to browse files</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Toolbar */}
                    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/20">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-2">
                        <Database className="w-3.5 h-3.5" />
                        <ChevronRight className="w-3 h-3" />
                        <span className="text-foreground font-medium">{selectedBucket}</span>
                      </div>
                      <div className="flex-1 relative max-w-xs">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="Filter files…"
                          value={search}
                          onChange={e => setSearch(e.target.value)}
                          className="h-7 text-xs pl-8 pr-7 bg-background"
                        />
                        {search && <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setSearch("")}><X className="w-3 h-3" /></button>}
                      </div>
                      <div className="flex items-center gap-1 ml-auto">
                        {selected.size > 0 && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteFiles(Array.from(selected))}>
                            <Trash2 className="w-3.5 h-3.5 mr-1" />Delete ({selected.size})
                          </Button>
                        )}
                        <Button size="sm" className="h-7 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none" onClick={() => setShowUpload(true)}>
                          <Upload className="w-3.5 h-3.5 mr-1" />Upload
                        </Button>
                      </div>
                    </div>

                    {/* File table */}
                    <div className="flex-1 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted/30 border-b border-border z-10">
                          <tr>
                            <th className="px-4 py-2.5 w-8">
                              <button onClick={toggleAll} className="text-muted-foreground hover:text-foreground">
                                {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                              </button>
                            </th>
                            <th className="px-2 py-2.5 text-left text-muted-foreground font-medium">Name</th>
                            <th className="px-4 py-2.5 text-right text-muted-foreground font-medium w-24">Size</th>
                            <th className="px-4 py-2.5 text-left text-muted-foreground font-medium w-40 hidden md:table-cell">Modified</th>
                            <th className="px-4 py-2.5 text-right text-muted-foreground font-medium w-28">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filesLoading ? (
                            Array.from({ length: 6 }).map((_, i) => (
                              <tr key={i} className="border-b border-border/50">
                                <td className="px-4 py-3"><Skeleton className="w-4 h-4 bg-muted" /></td>
                                <td className="px-2 py-3"><Skeleton className="h-3 w-48 bg-muted" /></td>
                                <td className="px-4 py-3"><Skeleton className="h-3 w-12 bg-muted ml-auto" /></td>
                                <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-3 w-24 bg-muted" /></td>
                                <td className="px-4 py-3"></td>
                              </tr>
                            ))
                          ) : files.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-16 text-center text-muted-foreground">
                                {search ? "No files match your filter" : "This bucket is empty — upload some files"}
                              </td>
                            </tr>
                          ) : (
                            files.map(f => (
                              <tr key={f.key} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${selected.has(f.key) ? "bg-primary/5" : ""}`}>
                                <td className="px-4 py-2.5">
                                  <button onClick={() => toggleFile(f.key)} className="text-muted-foreground hover:text-foreground">
                                    {selected.has(f.key) ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                                  </button>
                                </td>
                                <td className="px-2 py-2.5">
                                  <div className="flex items-center gap-2">
                                    {fileIcon(f.key)}
                                    <span className="font-mono text-foreground truncate max-w-xs" title={f.key}>{f.key}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{fmtBytes(f.size)}</td>
                                <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">{format(new Date(f.lastModified), "MMM dd, HH:mm")}</td>
                                <td className="px-4 py-2.5 text-right">
                                  <div className="flex items-center justify-end gap-0.5">
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" title="Download" onClick={() => handleDownload(f)}>
                                      <Download className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" title="Rename" onClick={() => setRenameFile(f)}>
                                      <Pencil className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Delete" onClick={() => setDeleteFiles([f.key])}>
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Footer */}
                    <div className="border-t border-border px-4 py-2 flex items-center justify-between bg-muted/10">
                      <span className="text-xs text-muted-foreground">
                        {files.length} file{files.length !== 1 ? "s" : ""}{selected.size > 0 ? ` · ${selected.size} selected` : ""}
                      </span>
                      {files.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {fmtBytes(files.reduce((a, f) => a + f.size, 0))} total
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Dialogs */}
      <ConnectDialog open={showConnect} onClose={() => setShowConnect(false)} onConnected={refresh} />
      <CreateInstanceDialog open={showCreateInstance} onClose={() => setShowCreateInstance(false)} onCreated={() => { refresh(); qc.invalidateQueries({ queryKey: ["storage-instance"] }); }} />

      <Dialog open={showCreateBucket} onOpenChange={(o) => { if (!o) setShowCreateBucket(false); }}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle className="text-sm font-medium">Create Bucket</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateBucket} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Bucket name</Label>
              <Input placeholder="my-bucket" value={bucketName} onChange={e => setBucketName(e.target.value)} className="h-8 text-xs" autoFocus required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowCreateBucket(false)}>Cancel</Button>
              <Button type="submit" size="sm" className="h-8 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none">
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {selectedBucket && (
        <UploadDialog
          bucket={selectedBucket}
          open={showUpload}
          onClose={() => setShowUpload(false)}
          onDone={() => { qc.invalidateQueries({ queryKey: ["storage-files"] }); refetchFiles(); }}
        />
      )}

      {selectedBucket && renameFile && (
        <RenameDialog
          bucket={selectedBucket}
          file={renameFile}
          open={!!renameFile}
          onClose={() => setRenameFile(null)}
          onDone={() => { qc.invalidateQueries({ queryKey: ["storage-files"] }); refetchFiles(); }}
        />
      )}

      <AlertDialog open={!!deleteBucket} onOpenChange={(o) => { if (!o) setDeleteBucket(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete bucket "{deleteBucket}"?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the bucket and all files inside it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={handleDeleteBucket}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteFiles.length > 0} onOpenChange={(o) => { if (!o) setDeleteFiles([]); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteFiles.length} file{deleteFiles.length !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => handleDeleteFiles(deleteFiles)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
