import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Play, Clock, ChevronDown, ChevronRight, ToggleLeft, ToggleRight, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetContainerSchedules, containerScheduleCreate, containerScheduleUpdate,
  containerScheduleDelete, containerScheduleRun, containerScheduleLogs,
  type ContainerSchedule, type ContainerScheduleLog,
} from "@/api/client";

const PRESETS = [
  { label: "Every minute",  value: "* * * * *" },
  { label: "Every 5 min",   value: "*/5 * * * *" },
  { label: "Every 15 min",  value: "*/15 * * * *" },
  { label: "Every hour",    value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Weekly (Mon)", value: "0 0 * * 1" },
  { label: "Custom…",       value: "custom" },
];

interface Props { containerName: string; open: boolean; onClose: () => void }

export default function SchedulerDialog({ containerName, open, onClose }: Props) {
  const qc = useQueryClient();
  const { data, isLoading } = useGetContainerSchedules(open ? containerName : "");
  const schedules = data?.schedules || [];

  const [showAdd, setShowAdd] = useState(false);
  const [label, setLabel] = useState("");
  const [cronPreset, setCronPreset] = useState("* * * * *");
  const [customCron, setCustomCron] = useState("");
  const [command, setCommand] = useState("");
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<number | null>(null);
  const [logEntries, setLogEntries] = useState<ContainerScheduleLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const isCustom = cronPreset === "custom";
  const finalCron = isCustom ? customCron : cronPreset;

  const refresh = () => qc.invalidateQueries({ queryKey: ["container-schedules", containerName] });

  async function handleAdd() {
    if (!label.trim() || !command.trim() || !finalCron) return;
    setSaving(true);
    try {
      await containerScheduleCreate(containerName, { label, cron_expr: finalCron, command, enabled: true });
      toast.success("Schedule created");
      setLabel(""); setCronPreset("* * * * *"); setCustomCron(""); setCommand(""); setShowAdd(false);
      refresh();
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  }

  async function handleToggle(s: ContainerSchedule) {
    try {
      await containerScheduleUpdate(containerName, s.id, { enabled: !s.enabled });
      refresh();
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleDelete(id: number) {
    try {
      await containerScheduleDelete(containerName, id);
      toast.success("Schedule deleted");
      refresh();
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleRun(s: ContainerSchedule) {
    setRunningId(s.id);
    try {
      await containerScheduleRun(containerName, s.id);
      toast.success("Executed");
      refresh();
    } catch (err: any) { toast.error(err.message); }
    finally { setRunningId(null); }
  }

  async function toggleLogs(s: ContainerSchedule) {
    if (expandedLogs === s.id) { setExpandedLogs(null); return; }
    setExpandedLogs(s.id);
    setLogsLoading(true);
    try {
      const { logs } = await containerScheduleLogs(containerName, s.id);
      setLogEntries(logs);
    } catch { setLogEntries([]); }
    finally { setLogsLoading(false); }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[680px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-5 pb-3 border-b border-border">
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            Scheduler — {containerName}
          </DialogTitle>
          <DialogDescription className="text-xs">Run commands inside the container on a schedule (cron).</DialogDescription>
        </DialogHeader>

        <div className="max-h-[500px] overflow-y-auto p-4 space-y-3">
          {/* Add form */}
          {showAdd ? (
            <div className="border border-border rounded-xl p-4 space-y-3 bg-muted/20">
              <p className="text-xs font-medium">New Schedule</p>
              <Input placeholder="Label (e.g. Daily cleanup)" value={label} onChange={e => setLabel(e.target.value)} className="h-8 text-xs" />
              <div className="flex gap-2">
                <Select value={cronPreset} onValueChange={setCronPreset}>
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue placeholder="Select interval" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRESETS.map(p => <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {isCustom && (
                  <Input placeholder="*/5 * * * *" value={customCron} onChange={e => setCustomCron(e.target.value)}
                    className="h-8 text-xs font-mono flex-1" />
                )}
              </div>
              <Input placeholder="Command to run (e.g. /app/cleanup.sh)" value={command} onChange={e => setCommand(e.target.value)} className="h-8 text-xs font-mono" />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button size="sm" className="h-7 text-xs bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none"
                  onClick={handleAdd} disabled={saving || !label.trim() || !command.trim()}>
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Schedule"}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="h-8 text-xs w-full border-dashed" onClick={() => setShowAdd(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" />Add Schedule
            </Button>
          )}

          {/* List */}
          {isLoading ? (
            <div className="space-y-2">{[1,2].map(i => <Skeleton key={i} className="h-16 rounded-xl bg-muted" />)}</div>
          ) : schedules.length === 0 && !showAdd ? (
            <div className="text-center py-10 text-muted-foreground text-xs">No schedules yet.</div>
          ) : (
            <div className="space-y-2">
              {schedules.map(s => (
                <div key={s.id} className="border border-border rounded-xl overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-background">
                    <button onClick={() => handleToggle(s)} className="shrink-0 text-muted-foreground hover:text-foreground">
                      {s.enabled ? <ToggleRight className="w-5 h-5 text-primary" /> : <ToggleLeft className="w-5 h-5" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{s.label}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{s.cron_expr} · <span className="font-sans">{s.command}</span></p>
                    </div>
                    {s.last_run && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        Last: {format(new Date(Number(s.last_run)), "MMM d HH:mm")}
                      </span>
                    )}
                    <Badge variant="outline" className={`text-[10px] rounded-full px-2 py-0 ${s.enabled ? "text-primary border-primary/30 bg-primary/5" : "text-muted-foreground"}`}>
                      {s.enabled ? "on" : "off"}
                    </Badge>
                    <button onClick={() => handleRun(s)} disabled={runningId === s.id}
                      className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors" title="Run now">
                      {runningId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => toggleLogs(s)}
                      className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors" title="Logs">
                      {expandedLogs === s.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => handleDelete(s.id)}
                      className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {expandedLogs === s.id && (
                    <div className="border-t border-border bg-[#0d0d0d] p-3 max-h-48 overflow-y-auto">
                      {logsLoading ? (
                        <div className="flex items-center gap-2 text-muted-foreground text-xs">
                          <Loader2 className="w-3 h-3 animate-spin" />Loading logs…
                        </div>
                      ) : logEntries.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No runs yet.</p>
                      ) : (
                        <div className="space-y-3">
                          {logEntries.map(log => (
                            <div key={log.id}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${log.status === 'success' ? 'bg-emerald-500/20 text-emerald-400' : log.status === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                  {log.status}
                                </span>
                                <span className="text-[10px] text-muted-foreground">{format(new Date(Number(log.started_at)), "MMM d HH:mm:ss")}</span>
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
