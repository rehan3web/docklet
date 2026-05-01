import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Play, Database, ChevronDown, ChevronRight, ToggleLeft, ToggleRight, Loader2, HardDrive, RotateCw, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetContainerBackups, containerBackupCreate, containerBackupUpdate,
  containerBackupDelete, containerBackupRun, containerBackupLogs,
  containerBackupS3Files, containerRestore,
  type ContainerBackup, type ContainerBackupLog, type S3BackupFile,
} from "@/api/client";
import { useIsStorageConfigured } from "@/api/client";

const CRON_PRESETS = [
  { label: "Manual only",    value: "manual" },
  { label: "Every minute",   value: "* * * * *" },
  { label: "Every hour",     value: "0 * * * *" },
  { label: "Every 6 hours",  value: "0 */6 * * *" },
  { label: "Daily midnight", value: "0 0 * * *" },
  { label: "Weekly (Mon)",   value: "0 0 * * 1" },
  { label: "Custom…",        value: "custom" },
];

interface Props { containerName: string; open: boolean; onClose: () => void }

export default function BackupDialog({ containerName, open, onClose }: Props) {
  const qc = useQueryClient();
  const { data: storageConfigData } = useIsStorageConfigured();
  const storageReady = storageConfigData?.configured === true;

  const { data, isLoading } = useGetContainerBackups(open ? containerName : "");
  const backups = data?.backups || [];

  const [showAdd, setShowAdd] = useState(false);
  const [label, setLabel] = useState("");
  const [bucket, setBucket] = useState("");
  const [prefix, setPrefix] = useState("");
  const [keepN, setKeepN] = useState("5");
  const [cronPreset, setCronPreset] = useState("");
  const [customCron, setCustomCron] = useState("");
  const [saving, setSaving] = useState(false);

  const [runningId, setRunningId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedTab, setExpandedTab] = useState<"logs" | "restore">("logs");
  const [logs, setLogs] = useState<ContainerBackupLog[]>([]);
  const [s3Files, setS3Files] = useState<S3BackupFile[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [selectedS3Key, setSelectedS3Key] = useState("");

  const isCustom = cronPreset === "custom";
  const finalCron = isCustom ? customCron : (cronPreset === "manual" ? "" : cronPreset);

  const refresh = () => qc.invalidateQueries({ queryKey: ["container-backups", containerName] });

  async function handleAdd() {
    if (!label.trim() || !bucket.trim()) return;
    setSaving(true);
    try {
      await containerBackupCreate(containerName, {
        label, s3_bucket: bucket, prefix, keep_n: parseInt(keepN) || 5,
        cron_expr: finalCron || undefined, enabled: true,
      });
      toast.success("Backup job created");
      setLabel(""); setBucket(""); setPrefix(""); setKeepN("5"); setCronPreset(""); setCustomCron("");
      setShowAdd(false);
      refresh();
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  }

  async function handleToggle(b: ContainerBackup) {
    try {
      await containerBackupUpdate(containerName, b.id, { enabled: !b.enabled });
      refresh();
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleDelete(id: number) {
    try {
      await containerBackupDelete(containerName, id);
      toast.success("Backup job deleted");
      if (expandedId === id) setExpandedId(null);
      refresh();
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleRun(b: ContainerBackup) {
    setRunningId(b.id);
    try {
      await containerBackupRun(containerName, b.id);
      toast.success("Backup started");
      setTimeout(refresh, 2000);
    } catch (err: any) { toast.error(err.message); }
    finally { setRunningId(null); }
  }

  async function toggleExpand(b: ContainerBackup, tab: "logs" | "restore") {
    if (expandedId === b.id && expandedTab === tab) { setExpandedId(null); return; }
    setExpandedId(b.id);
    setExpandedTab(tab);
    setLogsLoading(true);
    try {
      if (tab === "logs") {
        const { logs: l } = await containerBackupLogs(containerName, b.id);
        setLogs(l);
      } else {
        const { files } = await containerBackupS3Files(containerName, b.id);
        setS3Files(files);
      }
    } catch { setLogs([]); setS3Files([]); }
    finally { setLogsLoading(false); }
  }

  async function handleRestore(b: ContainerBackup) {
    if (!selectedS3Key) { toast.error("Select a backup file to restore"); return; }
    setRestoring(selectedS3Key);
    try {
      await containerRestore(containerName, b.s3_bucket, selectedS3Key);
      toast.success("Restore started in background");
    } catch (err: any) { toast.error(err.message); }
    finally { setRestoring(null); }
  }

  if (!storageReady) {
    return (
      <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
        <DialogContent className="sm:max-w-[500px] p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-5 pb-3 border-b border-border">
            <DialogTitle className="text-sm font-medium flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-muted-foreground" />
              Backups — {containerName}
            </DialogTitle>
          </DialogHeader>
          <div className="p-8 text-center space-y-3">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
            <p className="text-sm font-medium">S3 Storage not configured</p>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Please configure S3 Storage (MinIO) in the Storage page to enable container backups.
            </p>
          </div>
          <div className="p-4 border-t border-border flex justify-end">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[700px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-5 pb-3 border-b border-border">
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-muted-foreground" />
            Backups — {containerName}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Native database dump (pg_dump / mysqldump / mongodump) — uploaded directly to S3/MinIO. No full-container export.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[520px] overflow-y-auto p-4 space-y-3">
          {/* Add form */}
          {showAdd ? (
            <div className="border border-border rounded-xl p-4 space-y-3 bg-muted/20">
              <p className="text-xs font-medium">New Backup Job</p>
              <Input placeholder="Label (e.g. Daily DB backup)" value={label} onChange={e => setLabel(e.target.value)} className="h-8 text-xs" />
              <div className="flex gap-2">
                <Input placeholder="S3 bucket name" value={bucket} onChange={e => setBucket(e.target.value)} className="h-8 text-xs flex-1" />
                <Input placeholder="Prefix (optional)" value={prefix} onChange={e => setPrefix(e.target.value)} className="h-8 text-xs w-36" />
              </div>
              <div className="flex gap-2 items-center">
                <Select value={cronPreset} onValueChange={setCronPreset}>
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue placeholder="Schedule" />
                  </SelectTrigger>
                  <SelectContent>
                    {CRON_PRESETS.map(p => <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {isCustom && (
                  <Input placeholder="Cron expression" value={customCron} onChange={e => setCustomCron(e.target.value)} className="h-8 text-xs font-mono flex-1" />
                )}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs text-muted-foreground">Keep</span>
                  <Input value={keepN} onChange={e => setKeepN(e.target.value)} className="h-8 text-xs w-14 text-center" type="number" min="1" />
                  <span className="text-xs text-muted-foreground">latest</span>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button size="sm" className="h-7 text-xs bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none"
                  onClick={handleAdd} disabled={saving || !label.trim() || !bucket.trim()}>
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Job"}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="h-8 text-xs w-full border-dashed" onClick={() => setShowAdd(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" />Add Backup Job
            </Button>
          )}

          {/* List */}
          {isLoading ? (
            <div className="space-y-2">{[1,2].map(i => <Skeleton key={i} className="h-16 rounded-xl bg-muted" />)}</div>
          ) : backups.length === 0 && !showAdd ? (
            <div className="text-center py-10 text-muted-foreground text-xs">No backup jobs yet.</div>
          ) : (
            <div className="space-y-2">
              {backups.map(b => (
                <div key={b.id} className="border border-border rounded-xl overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-background">
                    <button onClick={() => handleToggle(b)} className="shrink-0 text-muted-foreground hover:text-foreground">
                      {b.enabled ? <ToggleRight className="w-5 h-5 text-primary" /> : <ToggleLeft className="w-5 h-5" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{b.label}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {b.s3_bucket}{b.prefix ? `/${b.prefix}` : ""} · {b.cron_expr || "manual"} · keep {b.keep_n}
                      </p>
                    </div>
                    <Badge variant="outline" className={`text-[10px] rounded-full px-2 py-0 ${b.enabled ? "text-primary border-primary/30 bg-primary/5" : "text-muted-foreground"}`}>
                      {b.enabled ? "on" : "off"}
                    </Badge>
                    <button onClick={() => handleRun(b)} disabled={runningId === b.id}
                      className="text-muted-foreground hover:text-foreground p-1 rounded" title="Run now">
                      {runningId === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => toggleExpand(b, "logs")}
                      className="text-muted-foreground hover:text-foreground p-1 rounded" title="Logs">
                      {expandedId === b.id && expandedTab === "logs" ? <ChevronDown className="w-3.5 h-3.5" /> : <Database className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => toggleExpand(b, "restore")}
                      className="text-muted-foreground hover:text-foreground p-1 rounded" title="Restore">
                      {expandedId === b.id && expandedTab === "restore" ? <ChevronDown className="w-3.5 h-3.5" /> : <RotateCw className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => handleDelete(b.id)}
                      className="text-muted-foreground hover:text-destructive p-1 rounded">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {expandedId === b.id && expandedTab === "logs" && (
                    <div className="border-t border-border bg-[#0d0d0d] p-3 max-h-52 overflow-y-auto">
                      {logsLoading ? (
                        <div className="flex items-center gap-2 text-muted-foreground text-xs"><Loader2 className="w-3 h-3 animate-spin" />Loading…</div>
                      ) : logs.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No runs yet.</p>
                      ) : (
                        <div className="space-y-3">
                          {logs.map(log => (
                            <div key={log.id}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${log.status === 'success' ? 'bg-emerald-500/20 text-emerald-400' : log.status === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                  {log.status}
                                </span>
                                <span className="text-[10px] text-muted-foreground">{format(new Date(Number(log.started_at)), "MMM d HH:mm:ss")}</span>
                                {log.s3_key && <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[160px]">{log.s3_key}</span>}
                              </div>
                              <pre className="font-mono text-[10px] text-green-400 whitespace-pre-wrap leading-relaxed">
                                {log.output || "(no output)"}
                              </pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {expandedId === b.id && expandedTab === "restore" && (
                    <div className="border-t border-border p-3 space-y-2 bg-muted/10">
                      <p className="text-xs font-medium">Restore from S3</p>
                      {logsLoading ? (
                        <div className="flex items-center gap-2 text-muted-foreground text-xs"><Loader2 className="w-3 h-3 animate-spin" />Loading files…</div>
                      ) : s3Files.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No backups found in S3.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {s3Files.map(f => (
                            <label key={f.key} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${selectedS3Key === f.key ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                              <input type="radio" name={`restore-${b.id}`} value={f.key}
                                checked={selectedS3Key === f.key}
                                onChange={() => setSelectedS3Key(f.key || "")}
                                className="sr-only" />
                              <HardDrive className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-mono truncate">{f.key?.split("/").pop()}</p>
                                <p className="text-[10px] text-muted-foreground">
                                  {f.lastModified ? format(new Date(f.lastModified), "MMM d yyyy HH:mm") : ""} · {f.size != null ? (f.size >= 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : f.size >= 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size} B`) : ""}
                                </p>
                              </div>
                            </label>
                          ))}
                          <Button size="sm" className="h-8 text-xs w-full mt-2 bg-amber-500/10 border border-amber-500/30 text-amber-600 hover:bg-amber-500/20 shadow-none"
                            onClick={() => handleRestore(b)} disabled={!!restoring || !selectedS3Key}>
                            {restoring ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />Restoring…</> : <><RotateCw className="w-3.5 h-3.5 mr-1" />Restore Selected</>}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border flex justify-end">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
