import { copyToClipboard } from "@/lib/utils";
import React, { useState, useRef, useCallback, useEffect } from "react";
import { Sun, Moon, Database, Plus, Trash2, RefreshCw, Upload, Download, Pencil, Search, X, FolderOpen, Folder, FolderPlus, File, FileText, FileImage, FileCode, Archive, CheckSquare, Square, ChevronRight, ChevronDown, Loader2, Unplug, Link2, Container, Zap, CheckCircle2, Circle, Globe, Shield, ShieldCheck, Share2, Copy, ExternalLink, Timer, Lock, Unlock, Check, AlertCircle, Server, Home } from "lucide-react";
import { format } from "date-fns";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
  useGetStorageInstance, useGetStorageDomain,
  storageConnect, storageDisconnect, storageCreateBucket, storageDeleteBucket,
  storageDeleteFiles, storageRenameFile, storageDownloadUrl, storageUploadFile, storageCreateFolder,
  storageCreateInstance, storageInstanceHealth, storageDestroyInstance,
  storageAddDomain, storageVerifyDomain, storageSetupNginx, storageRemoveDomain,
  storageGetBucketPolicy, storageSetBucketPolicy, storageShareFile,
  useGetVerifiedDomains,
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
type StepStatus = "pending" | "active" | "done" | "error";
type CreateStep = { label: string; status: StepStatus };

const INIT_STEPS: CreateStep[] = [
  { label: "Pull image & start container", status: "pending" },
  { label: "Join backend network", status: "pending" },
  { label: "Wait for MinIO to be ready", status: "pending" },
  { label: "Save connection", status: "pending" },
];

function CreateInstanceDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [accessKey, setAccessKey] = useState("minioadmin");
  const [secretKey, setSecretKey] = useState("minioadmin123");
  const [phase, setPhase] = useState<"form" | "creating" | "polling">("form");
  const [steps, setSteps] = useState<CreateStep[]>(INIT_STEPS);
  const [errorMsg, setErrorMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function markStep(idx: number, status: StepStatus) {
    setSteps(prev => prev.map((s, i) =>
      i < idx ? { ...s, status: "done" }
      : i === idx ? { ...s, status }
      : s
    ));
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  function reset() {
    stopPolling();
    setPhase("form");
    setErrorMsg("");
    setSteps(INIT_STEPS);
  }

  // Start polling health endpoint
  function startPolling(onReady: () => void, onError: (msg: string) => void) {
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const h = await storageInstanceHealth();
        if (h.ready) {
          stopPolling();
          markStep(3, "done");
          onReady();
        } else if (attempts > 60) {
          stopPolling();
          onError("MinIO did not become ready within 90 seconds. Check Docker logs for docklet-minio.");
        }
      } catch (err: any) {
        if (attempts > 60) {
          stopPolling();
          onError(err.message || "Health check failed");
        }
      }
    }, 1500);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (secretKey.length < 8) { toast.error("Secret key must be at least 8 characters"); return; }
    setErrorMsg("");
    setPhase("creating");
    setSteps(INIT_STEPS.map((s, i) => ({ ...s, status: i === 0 ? "active" : "pending" })));

    try {
      await storageCreateInstance(accessKey, secretKey);
      // Container is started and joined to network — now poll for readiness
      markStep(1, "done");
      markStep(2, "active");
      setPhase("polling");
      startPolling(
        () => {
          setPhase("form");
          toast.success("MinIO instance created and connected");
          onCreated();
          onClose();
          reset();
        },
        (msg) => {
          markStep(2, "error");
          setErrorMsg(msg);
          setPhase("creating"); // stay on progress view
        }
      );
    } catch (err: any) {
      markStep(0, "error");
      setErrorMsg(err.message || "Failed to create instance");
      setPhase("creating");
    }
  }

  useEffect(() => { return () => stopPolling(); }, []);

  const busy = phase === "creating" || phase === "polling";

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

        {phase === "form" ? (
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
              <div className="flex items-center gap-1.5"><Zap className="w-3 h-3 text-primary" /><span>Ports <strong className="text-foreground">9000</strong> (API) and <strong className="text-foreground">9001</strong> (Console) bound on host</span></div>
              <div className="flex items-center gap-1.5"><Database className="w-3 h-3 text-primary" /><span>Data at <code className="font-mono">/var/lib/docklet/minio-data</code></span></div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Cancel</Button>
              <Button type="submit" size="sm" className="h-8 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none">
                Create Instance
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="py-2 space-y-4">
            <div className="space-y-3">
              {steps.map((s, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="mt-0.5 shrink-0">
                    {s.status === "done" && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                    {s.status === "active" && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
                    {s.status === "pending" && <Circle className="w-4 h-4 text-muted-foreground/25" />}
                    {s.status === "error" && <X className="w-4 h-4 text-destructive" />}
                  </div>
                  <span className={`text-xs leading-5 ${
                    s.status === "active" ? "text-foreground font-medium"
                    : s.status === "done" ? "text-muted-foreground"
                    : s.status === "error" ? "text-destructive"
                    : "text-muted-foreground/40"
                  }`}>
                    {s.label}
                    {s.status === "active" && i === 2 && (
                      <span className="ml-1 text-muted-foreground font-normal">polling every 1.5 s…</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            {errorMsg && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-xs text-destructive">
                {errorMsg}
                <button className="block mt-1.5 text-foreground underline underline-offset-2 text-xs" onClick={reset}>Try again</button>
              </div>
            )}
            {!errorMsg && <p className="text-xs text-muted-foreground">Hang tight — MinIO is initializing. This usually takes 5–15 seconds.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Domain Panel ──────────────────────────────────────────────────────────────
function DomainPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useGetStorageDomain();
  const domain = data?.domain;
  const serverIP = data?.serverIP || "";

  const { data: vdData } = useGetVerifiedDomains();
  const verifiedDomains = (vdData?.domains ?? []).filter(d => d.verified);

  const [baseDomainId, setBaseDomainId] = useState<number | "">("");
  const [storageSub, setStorageSub] = useState("storage");
  const [domainInput, setDomainInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ verified: boolean; resolved: string[]; reason?: string } | null>(null);
  const [copied, setCopied] = useState("");

  const selectedVd = verifiedDomains.find(d => d.id === baseDomainId) ?? null;
  const fullDomainPreview = selectedVd
    ? (storageSub.trim() ? `${storageSub.trim()}.${selectedVd.domain}` : selectedVd.domain)
    : domainInput;

  function copyText(text: string, key: string) {
    copyToClipboard(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 2000);
  }

  async function handleAddDomain(e: React.FormEvent) {
    e.preventDefault();
    const finalDomain = fullDomainPreview.trim();
    if (!finalDomain) return;
    setBusy(true);
    try {
      await storageAddDomain(finalDomain);
      toast.success("Domain saved");
      setDomainInput("");
      qc.invalidateQueries({ queryKey: ["storage-domain"] });
    } catch (err: any) { toast.error(err.message); }
    finally { setBusy(false); }
  }

  async function handleVerify() {
    setBusy(true);
    setVerifyResult(null);
    try {
      const r = await storageVerifyDomain();
      setVerifyResult(r);
      if (r.verified) { toast.success("Domain verified!"); qc.invalidateQueries({ queryKey: ["storage-domain"] }); }
      else toast.error(r.reason || "DNS does not point to your server yet");
    } catch (err: any) { toast.error(err.message); }
    finally { setBusy(false); }
  }

  async function handleNginx() {
    setBusy(true);
    try {
      await storageSetupNginx();
      toast.success("Nginx proxy configured — domain is live");
      qc.invalidateQueries({ queryKey: ["storage-domain"] });
    } catch (err: any) { toast.error(err.message); }
    finally { setBusy(false); }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      await storageRemoveDomain();
      toast.success("Domain removed");
      qc.invalidateQueries({ queryKey: ["storage-domain"] });
    } catch (err: any) { toast.error(err.message); }
    finally { setBusy(false); }
  }

  if (isLoading) return <div className="flex items-center gap-2 text-xs text-muted-foreground p-4"><Loader2 className="w-3 h-3 animate-spin" />Loading domain info…</div>;

  const dnsRecords = serverIP ? [
    { type: "A", name: "@", value: serverIP, note: "Root domain" },
    { type: "A", name: "www", value: serverIP, note: "WWW subdomain" },
    { type: "A", name: domain?.domain.split(".")[0] || "storage", value: serverIP, note: "Custom subdomain" },
  ] : [];

  return (
    <div className="max-w-2xl space-y-6">
      {/* Server IP card */}
      <Card className="bg-background border-border shadow-none rounded-xl">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted"><Server className="w-4 h-4 text-muted-foreground" /></div>
          <div>
            <p className="text-xs font-medium text-foreground">Your Server IP</p>
            {serverIP ? (
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono text-primary">{serverIP}</code>
                <button onClick={() => copyText(serverIP, "ip")} className="text-muted-foreground hover:text-foreground">
                  {copied === "ip" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            ) : <p className="text-xs text-muted-foreground">Could not detect — check your VPS firewall</p>}
          </div>
        </CardContent>
      </Card>

      {/* Step 1: Add domain */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${domain ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground border border-border"}`}>
            {domain ? <Check className="w-3 h-3" /> : "1"}
          </div>
          <h3 className="text-sm font-medium">Connect Domain</h3>
          {domain && <button onClick={handleRemove} disabled={busy} className="text-xs text-muted-foreground hover:text-destructive ml-auto">Remove</button>}
        </div>
        {!domain ? (
          <form onSubmit={handleAddDomain} className="ml-7 space-y-2">
            {verifiedDomains.length > 0 ? (
              <div className="flex gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 text-xs justify-between font-mono px-2 flex-1 min-w-0">
                      <span className={`truncate ${baseDomainId === "" ? "text-muted-foreground" : ""}`}>{baseDomainId === "" ? "— Base domain —" : (verifiedDomains.find(d => d.id === baseDomainId)?.domain ?? "— Base domain —")}</span>
                      <ChevronDown className="w-3 h-3 shrink-0 opacity-50 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="min-w-[200px] rounded-xl p-1.5 shadow-lg">
                    <DropdownMenuItem className="px-2.5 py-2 rounded-lg cursor-pointer text-xs text-muted-foreground" onClick={() => setBaseDomainId("")}>— Base domain —</DropdownMenuItem>
                    {verifiedDomains.map(d => (
                      <DropdownMenuItem key={d.id} className="px-2.5 py-2 rounded-lg cursor-pointer gap-2.5 text-xs font-mono" onClick={() => setBaseDomainId(d.id)}>
                        <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />{d.domain}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Input
                  placeholder="storage"
                  value={storageSub}
                  onChange={e => setStorageSub(e.target.value)}
                  className="h-8 text-xs w-28"
                />
                <Button type="submit" size="sm" disabled={busy || !fullDomainPreview} className="h-8 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none shrink-0">
                  {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input placeholder="storage.yourdomain.com" value={domainInput} onChange={e => setDomainInput(e.target.value)} className="h-8 text-xs flex-1" required />
                <Button type="submit" size="sm" disabled={busy} className="h-8 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none">
                  {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                </Button>
              </div>
            )}
            {fullDomainPreview && verifiedDomains.length > 0 && (
              <p className="text-[11px] text-muted-foreground font-mono">→ <span className="text-foreground">{fullDomainPreview}</span></p>
            )}
          </form>
        ) : (
          <div className="ml-7 flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-primary shrink-0" />
            <code className="text-xs font-mono text-foreground">{domain.domain}</code>
            <Badge variant="outline" className={`text-[10px] px-2 py-0 rounded-full ${domain.verified ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/20" : "text-amber-600 bg-amber-500/10 border-amber-500/20"}`}>
              {domain.verified ? "Verified" : "Unverified"}
            </Badge>
          </div>
        )}
      </div>

      {/* Step 2: DNS Records */}
      {domain && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${domain.verified ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground border border-border"}`}>
              {domain.verified ? <Check className="w-3 h-3" /> : "2"}
            </div>
            <h3 className="text-sm font-medium">Add DNS Records in Cloudflare</h3>
          </div>
          {!domain.verified && (
            <div className="ml-7 space-y-3">
              <p className="text-xs text-muted-foreground">Create these A records in your Cloudflare DNS dashboard:</p>
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 border-b border-border">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Type</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Value</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dnsRecords.map((r, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="px-3 py-2"><Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">{r.type}</Badge></td>
                        <td className="px-3 py-2 font-mono text-foreground">{r.name}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <code className="font-mono text-primary">{r.value || "..."}</code>
                            {r.value && <button onClick={() => copyText(r.value, `dns-${i}`)} className="text-muted-foreground hover:text-foreground">{copied === `dns-${i}` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}</button>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{r.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-2">
                {verifyResult && !verifyResult.verified && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {verifyResult.reason || `Resolved to ${verifyResult.resolved.join(", ") || "nothing"} — expected ${serverIP}`}
                  </p>
                )}
                <Button size="sm" onClick={handleVerify} disabled={busy} className="h-7 text-xs ml-auto border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none">
                  {busy ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Checking…</> : "Verify Domain"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Nginx */}
      {domain?.verified && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${domain.nginx_enabled ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground border border-border"}`}>
              {domain.nginx_enabled ? <Check className="w-3 h-3" /> : "3"}
            </div>
            <h3 className="text-sm font-medium">Activate Nginx Proxy</h3>
          </div>
          <div className="ml-7">
            {domain.nginx_enabled ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                  <CheckCircle2 className="w-4 h-4" />Domain proxy is active
                </div>
                <p className="text-xs text-muted-foreground">Public buckets are accessible at:</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-primary">http://{domain.domain}/{"<bucket>/<file>"}</code>
                  <a href={`http://${domain.domain}`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="border-t border-emerald-500/20 pt-2">
                  <Button size="sm" variant="ghost" onClick={handleNginx} disabled={busy}
                    className="h-7 text-xs text-muted-foreground hover:text-foreground">
                    {busy ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Re-applying…</> : <><RefreshCw className="w-3 h-3 mr-1.5" />Re-apply Nginx Config</>}
                  </Button>
                  <p className="text-[10px] text-muted-foreground mt-1">Use this if the proxy isn't routing correctly — it rewrites the nginx config and reloads.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Configure Nginx to proxy <strong className="text-foreground">{domain.domain}</strong> → MinIO. This updates the <code className="font-mono bg-muted px-1 rounded text-[10px]">docklet-nginx</code> container automatically.</p>
                <Button size="sm" onClick={handleNginx} disabled={busy} className="h-7 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none">
                  {busy ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Setting up…</> : <><Globe className="w-3 h-3 mr-1.5" />Activate Nginx Proxy</>}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Share Dialog ───────────────────────────────────────────────────────────────
const EXPIRY_PRESETS = [
  { label: "1 hour", value: 3600 },
  { label: "8 hours", value: 28800 },
  { label: "24 hours", value: 86400 },
  { label: "7 days", value: 604800 },
];

function ShareDialog({ bucket, file, open, onClose, isPublic, domain, serverIP }: {
  bucket: string; file: StorageFile | null; open: boolean; onClose: () => void;
  isPublic: boolean; domain: string | null; serverIP: string;
}) {
  const [expiresIn, setExpiresIn] = useState(3600);
  const [shareUrl, setShareUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");

  useEffect(() => { if (!open) { setShareUrl(""); setExpiresAt(""); } }, [open]);

  function copyText(text: string, key: string) {
    copyToClipboard(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 2000);
  }

  async function generate() {
    if (!file) return;
    setBusy(true);
    try {
      const r = await storageShareFile(bucket, file.key, expiresIn);
      setShareUrl(r.url);
      setExpiresAt(r.expiresAt);
    } catch (err: any) { toast.error(err.message); }
    finally { setBusy(false); }
  }

  const publicUrl = file ? (domain ? `http://${domain}/${bucket}/${file.key}` : serverIP ? `http://${serverIP}:9000/${bucket}/${file.key}` : null) : null;
  const name = file?.key.split("/").pop() || file?.key || "";

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <Share2 className="w-4 h-4 text-muted-foreground" />Share File
          </DialogTitle>
          <DialogDescription className="text-xs font-mono truncate">{name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {/* Private share link */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium">Private Share Link</span>
              <Badge variant="outline" className="text-[10px] px-2 py-0 rounded-full ml-auto">Signed URL</Badge>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {EXPIRY_PRESETS.map(p => (
                <button key={p.value} onClick={() => { setExpiresIn(p.value); setShareUrl(""); }}
                  className={`px-2 py-1.5 rounded-lg text-[11px] border transition-all ${expiresIn === p.value ? "border-primary bg-primary/10 text-foreground font-medium" : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"}`}>
                  {p.label}
                </button>
              ))}
            </div>
            {shareUrl ? (
              <div className="space-y-1.5">
                <div className="rounded-lg bg-muted/40 border border-border px-3 py-2 space-y-1.5">
                  <code className="block text-[10px] font-mono text-primary break-all leading-relaxed">{shareUrl}</code>
                  <div className="flex items-center gap-2 border-t border-border/50 pt-1.5">
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1 flex-1">
                      <Timer className="w-3 h-3 shrink-0" />Expires {format(new Date(expiresAt), "MMM dd, yyyy 'at' HH:mm")}
                    </p>
                    <button onClick={() => copyText(shareUrl, "private")} className="text-muted-foreground hover:text-foreground shrink-0 flex items-center gap-1 text-[10px]">
                      {copied === "private" ? <><Check className="w-3.5 h-3.5 text-emerald-500" /><span className="text-emerald-500">Copied</span></> : <><Copy className="w-3.5 h-3.5" /><span>Copy</span></>}
                    </button>
                    <a href={shareUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground shrink-0" title="Open in new tab">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              <Button size="sm" onClick={generate} disabled={busy} className="h-7 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none">
                {busy ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Generating…</> : <><Timer className="w-3 h-3 mr-1.5" />Generate Link</>}
              </Button>
            )}
          </div>

          {/* Public / Direct URL — always show when an endpoint is known */}
          {publicUrl && (
            <div className="border-t border-border pt-4 space-y-2">
              <div className="flex items-center gap-2">
                {isPublic ? <Unlock className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> : <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                <span className="text-xs font-medium">Public Direct URL</span>
                <Badge variant="outline" className={`text-[10px] px-2 py-0 rounded-full ml-auto ${isPublic ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/20" : "text-muted-foreground"}`}>
                  {isPublic ? "Public" : "Private"}
                </Badge>
              </div>
              <div className="rounded-lg bg-muted/40 border border-border px-3 py-2 space-y-1.5">
                <code className="block text-[10px] font-mono text-primary break-all leading-relaxed">{publicUrl}</code>
                <div className="flex items-center gap-2 border-t border-border/50 pt-1.5">
                  {!isPublic && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 flex-1">
                      <Lock className="w-3 h-3 shrink-0" />Bucket is private — toggle Public in Files to activate
                    </p>
                  )}
                  {isPublic && <span className="flex-1" />}
                  <button onClick={() => copyText(publicUrl, "public")} className="text-muted-foreground hover:text-foreground shrink-0 flex items-center gap-1 text-[10px]">
                    {copied === "public" ? <><Check className="w-3.5 h-3.5 text-emerald-500" /><span className="text-emerald-500">Copied</span></> : <><Copy className="w-3.5 h-3.5" /><span>Copy</span></>}
                  </button>
                  {isPublic && (
                    <a href={publicUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground shrink-0">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Upload Zone ───────────────────────────────────────────────────────────────
interface UploadState { file: File; progress: number; done: boolean; error?: string }

function UploadDialog({ bucket, prefix = "", open, onClose, onDone }: { bucket: string; prefix?: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
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
    setUploading(true);
    for (let i = 0; i < uploads.length; i++) {
      if (uploads[i].done) continue;
      try {
        const key = prefix + uploads[i].file.name;
        await storageUploadFile(bucket, uploads[i].file, key, (pct) => {
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

  function handleClose() {
    setUploads([]);
    setUploading(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <Upload className="w-4 h-4 text-muted-foreground" /> Upload Files — {bucket}{prefix ? `/${prefix.replace(/\/$/, "")}` : ""}
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
        {/* File list — always show so user can see what they selected */}
        {uploads.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {uploads.map((u, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate max-w-[340px] text-foreground">{u.file.name}</span>
                  <span className={u.error ? "text-destructive" : u.done ? "text-emerald-500" : uploading ? "text-muted-foreground" : "text-muted-foreground/60"}>
                    {u.error ? "Failed" : u.done ? "Done" : uploading ? `${u.progress}%` : fmtBytes(u.file.size)}
                  </span>
                </div>
                {/* Progress bar only visible after upload starts */}
                {uploading && (
                  <Progress value={u.progress} className={`h-1 ${u.error ? "[&>div]:bg-destructive" : u.done ? "[&>div]:bg-emerald-500" : ""}`} />
                )}
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleClose}>Cancel</Button>
          <Button size="sm" disabled={uploads.length === 0 || uploading && !allDone} onClick={allDone ? handleClose : startUpload} className="h-8 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none">
            {uploading && !allDone ? <><Loader2 className="w-3 h-3 animate-spin mr-1.5" />Uploading…</> : allDone ? "Done" : "Upload"}
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
  const { data: domainData } = useGetStorageDomain();
  const activeDomain = domainData?.domain?.nginx_enabled ? domainData.domain.domain : null;
  const serverIP = domainData?.serverIP || "";
  const { data: bucketsData, isLoading: bucketsLoading } = useGetStorageBuckets(connected);

  const [activeView, setActiveView] = useState<"files" | "domain">("files");
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [selectedBucketIsPublic, setSelectedBucketIsPublic] = useState<boolean | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [currentFolder, setCurrentFolder] = useState<string>("");
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const { data: filesData, isLoading: filesLoading, refetch: refetchFiles } = useGetStorageFiles(selectedBucket);

  // Load bucket policy when selection changes
  useEffect(() => {
    if (!selectedBucket) { setSelectedBucketIsPublic(null); return; }
    setPolicyLoading(true);
    storageGetBucketPolicy(selectedBucket)
      .then(r => setSelectedBucketIsPublic(r.isPublic))
      .catch(() => setSelectedBucketIsPublic(false))
      .finally(() => setPolicyLoading(false));
  }, [selectedBucket]);

  // Dialogs
  const [showConnect, setShowConnect] = useState(false);
  const [showCreateInstance, setShowCreateInstance] = useState(false);
  const [shareFile, setShareFile] = useState<StorageFile | null>(null);
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

  async function handleTogglePolicy() {
    if (!selectedBucket || selectedBucketIsPublic === null) return;
    const next = !selectedBucketIsPublic;
    try {
      await storageSetBucketPolicy(selectedBucket, next);
      setSelectedBucketIsPublic(next);
      toast.success(next ? `${selectedBucket} is now public` : `${selectedBucket} is now private`);
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

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!newFolderName.trim() || !selectedBucket) return;
    setCreatingFolder(true);
    try {
      await storageCreateFolder(selectedBucket, `${currentFolder}${newFolderName.trim()}/`);
      toast.success(`Folder "${newFolderName.trim()}" created`);
      setNewFolderName("");
      setShowCreateFolder(false);
      refetchFiles();
    } catch (err: any) {
      toast.error(err.message || "Failed to create folder");
    } finally {
      setCreatingFolder(false);
    }
  }

  function navigateFolder(prefix: string) {
    setCurrentFolder(prefix);
    setSelected(new Set());
    setSearch("");
  }

  // ── Virtual folder tree from flat file list ──────────────────────────────
  const allFiles = filesData?.files || [];
  const prefixedFiles = currentFolder
    ? allFiles.filter(f => f.key.startsWith(currentFolder))
    : allFiles;

  const seenFolders = new Set<string>();
  const virtualFolders: { name: string; prefix: string }[] = [];
  const currentLevelFiles: StorageFile[] = [];

  for (const f of prefixedFiles) {
    const relKey = currentFolder ? f.key.slice(currentFolder.length) : f.key;
    if (!relKey) continue;
    const slashIdx = relKey.indexOf("/");
    if (slashIdx !== -1) {
      const folderName = relKey.slice(0, slashIdx);
      if (folderName && !seenFolders.has(folderName)) {
        seenFolders.add(folderName);
        virtualFolders.push({ name: folderName, prefix: currentFolder + folderName + "/" });
      }
    } else {
      currentLevelFiles.push(f);
    }
  }

  // Filter .keep placeholder files
  const visibleFiles = currentLevelFiles.filter(f => {
    const name = f.key.split("/").pop() || f.key;
    return name !== ".keep" && (!search || name.toLowerCase().includes(search.toLowerCase()));
  });
  const filteredFolders = virtualFolders.filter(d => !search || d.name.toLowerCase().includes(search.toLowerCase()));

  // Breadcrumb segments
  const pathSegments = currentFolder ? currentFolder.slice(0, -1).split("/") : [];

  const buckets = bucketsData?.buckets || [];

  const allSelected = visibleFiles.length > 0 && visibleFiles.every(f => selected.has(f.key));
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(visibleFiles.map(f => f.key)));
  }
  function toggleFile(key: string) {
    setSelected(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <DesktopSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="px-4 h-14 flex items-center justify-between">
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

          {/* Tab bar — only when connected */}
          {connected && (
            <div className="flex gap-0.5 border-b border-border mb-6 -mt-2">
              {[{ key: "files", label: "Files", icon: <Database className="w-3 h-3" /> }, { key: "domain", label: "Domain", icon: <Globe className="w-3 h-3" /> }].map(t => (
                <button key={t.key} onClick={() => setActiveView(t.key as any)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 transition-all ${activeView === t.key ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  {t.icon}{t.label}
                  {t.key === "domain" && domainData?.domain?.nginx_enabled && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ml-0.5" />}
                </button>
              ))}
            </div>
          )}

          {/* Domain view */}
          {connected && activeView === "domain" && <DomainPanel />}

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
          {connected && activeView === "files" && (
            <div className="flex flex-col md:flex-row gap-3 md:h-[calc(100vh-260px)] md:min-h-[500px]">

              {/* ── Bucket list ── */}
              <div className="md:w-56 md:shrink-0 md:flex md:flex-col md:gap-3">

                {/* Header row — both breakpoints */}
                <div className="flex items-center justify-between mb-2 md:mb-0">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Buckets</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" title="New bucket" onClick={() => setShowCreateBucket(true)}>
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {/* ── Mobile: horizontal scrollable chip row ── */}
                <div className="flex md:hidden gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                  {bucketsLoading ? (
                    Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full bg-muted" />)
                  ) : buckets.length === 0 ? (
                    <button onClick={() => setShowCreateBucket(true)} className="shrink-0 text-xs text-primary underline underline-offset-2">
                      Create a bucket
                    </button>
                  ) : buckets.map(b => (
                    <button
                      key={b.name}
                      onClick={() => { setSelectedBucket(b.name); setSelected(new Set()); setSearch(""); setCurrentFolder(""); }}
                      className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-all whitespace-nowrap ${
                        selectedBucket === b.name
                          ? "bg-muted text-foreground border-border font-medium"
                          : "text-muted-foreground border-transparent hover:border-border hover:text-foreground"
                      }`}
                    >
                      <FolderOpen className="w-3 h-3 shrink-0" />
                      {b.name}
                      {selectedBucket === b.name && !policyLoading && selectedBucketIsPublic !== null && (
                        <span className="text-[9px] font-medium" style={selectedBucketIsPublic ? { color: "#16a34a" } : { color: "#71717a" }}>
                          · {selectedBucketIsPublic ? "public" : "private"}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* ── Desktop: vertical list ── */}
                <div className="hidden md:block flex-1 overflow-y-auto space-y-0.5">
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
                        onClick={() => { setSelectedBucket(b.name); setSelected(new Set()); setSearch(""); setCurrentFolder(""); }}
                      >
                        <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-xs font-medium truncate flex-1">{b.name}</span>
                        {selectedBucket === b.name && !policyLoading && selectedBucketIsPublic !== null && (
                          <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full border font-medium mr-0.5 opacity-80" style={selectedBucketIsPublic ? { color: "#16a34a", background: "rgba(22,163,74,.08)", borderColor: "rgba(22,163,74,.25)" } : { color: "#71717a", background: "transparent", borderColor: "rgba(113,113,122,.25)" }}>
                            {selectedBucketIsPublic ? "public" : "private"}
                          </span>
                        )}
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

              {/* ── File Explorer ── */}
              <div className="flex-1 flex flex-col border border-border rounded-xl overflow-hidden bg-background min-h-[320px]">
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
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2 border-b border-border bg-muted/20">
                      {/* Breadcrumb */}
                      <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
                        <button onClick={() => navigateFolder("")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                          <Database className="w-3.5 h-3.5" />
                          <span className={currentFolder ? "hover:underline" : "text-foreground font-medium"}>{selectedBucket}</span>
                        </button>
                        {pathSegments.map((seg, i) => {
                          const segPrefix = pathSegments.slice(0, i + 1).join("/") + "/";
                          const isLast = i === pathSegments.length - 1;
                          return (
                            <React.Fragment key={segPrefix}>
                              <ChevronRight className="w-3 h-3 shrink-0" />
                              <button onClick={() => navigateFolder(segPrefix)} className={`hover:text-foreground transition-colors ${isLast ? "text-foreground font-medium" : "hover:underline"}`}>
                                {seg}
                              </button>
                            </React.Fragment>
                          );
                        })}
                      </div>

                      {/* Buttons — push right */}
                      <div className="flex items-center gap-1 ml-auto">
                        {selectedBucketIsPublic !== null && !policyLoading && (
                          <button onClick={handleTogglePolicy} title={selectedBucketIsPublic ? "Bucket is public — click to make private" : "Bucket is private — click to make public"}
                            className="flex items-center gap-1 h-7 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-all border border-transparent hover:border-border">
                            {selectedBucketIsPublic ? <Unlock className="w-3.5 h-3.5 text-emerald-500" /> : <Lock className="w-3.5 h-3.5" />}
                            <span className="hidden sm:inline">{selectedBucketIsPublic ? "Public" : "Private"}</span>
                          </button>
                        )}
                        {selected.size > 0 && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteFiles(Array.from(selected))}>
                            <Trash2 className="w-3.5 h-3.5 mr-1" /><span className="hidden sm:inline">Delete</span> ({selected.size})
                          </Button>
                        )}
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setNewFolderName(""); setShowCreateFolder(v => !v); }}>
                          <FolderPlus className="w-3.5 h-3.5 md:mr-1" /><span className="hidden md:inline">New Folder</span>
                        </Button>
                        <Button size="sm" className="h-7 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none" onClick={() => setShowUpload(true)}>
                          <Upload className="w-3.5 h-3.5 md:mr-1" /><span className="hidden md:inline">Upload</span>
                        </Button>
                      </div>

                      {/* Search — full width second row on mobile */}
                      <div className="relative w-full md:w-auto md:flex-1 md:max-w-xs order-last md:order-none">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="Filter…"
                          value={search}
                          onChange={e => setSearch(e.target.value)}
                          className="h-7 text-xs pl-8 pr-7 bg-background w-full"
                        />
                        {search && <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setSearch("")}><X className="w-3 h-3" /></button>}
                      </div>

                      {/* Create Folder inline form */}
                      {showCreateFolder && (
                        <form onSubmit={handleCreateFolder} className="w-full flex items-center gap-2 pt-1 border-t border-border mt-1">
                          <FolderPlus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <Input
                            autoFocus
                            placeholder="Folder name…"
                            value={newFolderName}
                            onChange={e => setNewFolderName(e.target.value)}
                            className="h-7 text-xs flex-1"
                          />
                          <Button type="submit" size="sm" disabled={creatingFolder || !newFolderName.trim()} className="h-7 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none shrink-0">
                            {creatingFolder ? <Loader2 className="w-3 h-3 animate-spin" /> : "Create"}
                          </Button>
                          <button type="button" onClick={() => setShowCreateFolder(false)} className="text-muted-foreground hover:text-foreground shrink-0"><X className="w-3.5 h-3.5" /></button>
                        </form>
                      )}
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
                          ) : filteredFolders.length === 0 && visibleFiles.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-16 text-center text-muted-foreground">
                                {search ? "No items match your filter" : "This folder is empty — upload some files or create a folder"}
                              </td>
                            </tr>
                          ) : (
                            <>
                              {/* Folders first */}
                              {filteredFolders.map(d => (
                                <tr key={d.prefix} className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => navigateFolder(d.prefix)}>
                                  <td className="px-4 py-2.5">
                                    <span className="text-muted-foreground/40"><Square className="w-4 h-4" /></span>
                                  </td>
                                  <td className="px-2 py-2.5">
                                    <div className="flex items-center gap-2">
                                      <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
                                      <span className="font-medium text-foreground">{d.name}</span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-muted-foreground/50 text-xs">—</td>
                                  <td className="px-4 py-2.5 text-muted-foreground/50 hidden md:table-cell text-xs">Folder</td>
                                  <td className="px-4 py-2.5 text-right">
                                    <div className="flex items-center justify-end gap-0.5">
                                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                                    </div>
                                  </td>
                                </tr>
                              ))}
                              {/* Files */}
                              {visibleFiles.map(f => {
                                const name = f.key.split("/").pop() || f.key;
                                return (
                                  <tr key={f.key} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${selected.has(f.key) ? "bg-primary/5" : ""}`}>
                                    <td className="px-4 py-2.5">
                                      <button onClick={() => toggleFile(f.key)} className="text-muted-foreground hover:text-foreground">
                                        {selected.has(f.key) ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                                      </button>
                                    </td>
                                    <td className="px-2 py-2.5">
                                      <div className="flex items-center gap-2">
                                        {fileIcon(f.key)}
                                        <span className="font-mono text-foreground truncate max-w-xs" title={f.key}>{name}</span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{fmtBytes(f.size)}</td>
                                    <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">{format(new Date(f.lastModified), "MMM dd, HH:mm")}</td>
                                    <td className="px-4 py-2.5 text-right">
                                      <div className="flex items-center justify-end gap-0.5">
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" title="Share" onClick={() => setShareFile(f)}>
                                          <Share2 className="w-3.5 h-3.5" />
                                        </Button>
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
                                );
                              })}
                            </>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Footer */}
                    <div className="border-t border-border px-4 py-2 flex items-center justify-between bg-muted/10">
                      <span className="text-xs text-muted-foreground">
                        {filteredFolders.length > 0 && `${filteredFolders.length} folder${filteredFolders.length !== 1 ? "s" : ""}`}
                        {filteredFolders.length > 0 && visibleFiles.length > 0 && " · "}
                        {visibleFiles.length > 0 && `${visibleFiles.length} file${visibleFiles.length !== 1 ? "s" : ""}`}
                        {selected.size > 0 ? ` · ${selected.size} selected` : ""}
                      </span>
                      {visibleFiles.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {fmtBytes(visibleFiles.reduce((a, f) => a + f.size, 0))} total
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
          prefix={currentFolder}
          open={showUpload}
          onClose={() => setShowUpload(false)}
          onDone={() => { qc.invalidateQueries({ queryKey: ["storage-files"] }); refetchFiles(); }}
        />
      )}

      {/* Share Dialog */}
      <ShareDialog
        bucket={selectedBucket || ""}
        file={shareFile}
        open={!!shareFile}
        onClose={() => setShareFile(null)}
        isPublic={selectedBucketIsPublic === true}
        domain={activeDomain}
        serverIP={serverIP}
      />

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
