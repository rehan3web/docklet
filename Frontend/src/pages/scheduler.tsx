import React, { useState } from "react";
import { Clock, Plus, Play, Trash2, Edit2, Sun, Moon, Loader2, CheckCircle2, XCircle, ChevronDown, CalendarClock, RefreshCw, FileText } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetScheduledTasks, useGetTaskRuns,
  createScheduledTask, updateScheduledTask, deleteScheduledTask, runScheduledTask,
  type ScheduledTask, type TaskRun,
} from "@/api/client";

const CRON_PRESETS = [
  { label: "Every minute (* * * * *)", value: "* * * * *" },
  { label: "Every hour (0 * * * *)", value: "0 * * * *" },
  { label: "Every day at midnight (0 0 * * *)", value: "0 0 * * *" },
  { label: "Every Sunday at midnight (0 0 * * 0)", value: "0 0 * * 0" },
  { label: "Every month on the 1st (0 0 1 * *)", value: "0 0 1 * *" },
  { label: "Every 15 minutes (*/15 * * * *)", value: "*/15 * * * *" },
  { label: "Every weekday at midnight (0 0 * * 1-5)", value: "0 0 * * 1-5" },
  { label: "Custom", value: "custom" },
];

const TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Tokyo", "Asia/Shanghai",
  "Asia/Kolkata", "Australia/Sydney",
];

const GREEN_BTN = "border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none";

function RunStatusBadge({ status }: { status: string }) {
  if (status === "success") return (
    <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 gap-1 text-primary bg-primary/10 border-primary/20 font-mono uppercase inline-flex items-center">
      <CheckCircle2 className="w-2.5 h-2.5" /> success
    </Badge>
  );
  if (status === "failed") return (
    <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 gap-1 text-destructive bg-destructive/10 border-destructive/30 font-mono uppercase inline-flex items-center">
      <XCircle className="w-2.5 h-2.5" /> failed
    </Badge>
  );
  return (
    <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 gap-1 text-amber-500 bg-amber-500/10 border-amber-500/30 font-mono uppercase inline-flex items-center">
      <Loader2 className="w-2.5 h-2.5 animate-spin" /> running
    </Badge>
  );
}

function TaskLogsDialog({ task, open, onClose }: { task: ScheduledTask; open: boolean; onClose: () => void }) {
  const [selectedRun, setSelectedRun] = useState<TaskRun | null>(null);
  const { data } = useGetTaskRuns(open ? task.id : null);
  const runs = data?.runs || [];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setSelectedRun(null); } }}>
      <DialogContent className="sm:max-w-[700px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-5 pb-3 border-b border-border">
          <DialogTitle className="text-sm font-medium">Run Logs — {task.name}</DialogTitle>
          <DialogDescription className="text-xs">Recent runs, newest first. Click a run to see its output.</DialogDescription>
        </DialogHeader>

        <div className="flex h-[420px] overflow-hidden">
          {/* Run list */}
          <div className="w-52 shrink-0 border-r border-border overflow-y-auto">
            <div className="p-2 space-y-1">
              {runs.length === 0 && (
                <p className="text-xs text-muted-foreground p-3 text-center">No runs yet</p>
              )}
              {runs.map((run) => (
                <button
                  key={run.id}
                  onClick={() => setSelectedRun(run)}
                  className={`w-full text-left p-2.5 rounded-md transition-colors border text-xs ${selectedRun?.id === run.id ? "bg-muted/60 border-border" : "border-transparent hover:bg-muted/40"}`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-mono text-[10px] text-muted-foreground">#{run.id}</span>
                    <RunStatusBadge status={run.status} />
                  </div>
                  <p className="font-mono text-[10px] text-muted-foreground">{format(new Date(Number(run.started_at)), "MMM dd, HH:mm:ss")}</p>
                  {run.finished_at && (
                    <p className="font-mono text-[10px] text-muted-foreground/60">
                      {((Number(run.finished_at) - Number(run.started_at)) / 1000).toFixed(1)}s
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Log output */}
          <div className="flex-1 overflow-y-auto min-w-0 bg-[#f8f8f8] dark:bg-[#0d0d0d]">
            {selectedRun ? (
              <pre className="font-mono text-[11px] p-4 whitespace-pre-wrap text-foreground leading-relaxed h-full">
                {selectedRun.output || "(no output)"}
              </pre>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground p-6 text-center">
                <div>
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p>Select a run to view its output</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-border flex justify-end">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { onClose(); setSelectedRun(null); }}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateEditDialog({
  open,
  onClose,
  editTask,
}: {
  open: boolean;
  onClose: () => void;
  editTask?: ScheduledTask | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(editTask?.name ?? "");
  const [cronPreset, setCronPreset] = useState<string>(() => {
    if (!editTask) return "";
    const match = CRON_PRESETS.find((p) => p.value === editTask.cron_expr && p.value !== "custom");
    return match ? match.value : "custom";
  });
  const [cronCustom, setCronCustom] = useState(editTask?.cron_expr ?? "");
  const [timezone, setTimezone] = useState(editTask?.timezone ?? "");
  const [script, setScript] = useState(editTask?.script ?? "");
  const [saving, setSaving] = useState(false);

  const cronExpr = cronPreset === "custom" || cronPreset === "" ? cronCustom : cronPreset;

  React.useEffect(() => {
    if (open) {
      setName(editTask?.name ?? "");
      const match = editTask ? CRON_PRESETS.find((p) => p.value === editTask.cron_expr && p.value !== "custom") : null;
      setCronPreset(match ? match.value : editTask ? "custom" : "");
      setCronCustom(editTask?.cron_expr ?? "");
      setTimezone(editTask?.timezone ?? "");
      setScript(editTask?.script ?? "");
    }
  }, [open, editTask]);

  async function handleSave() {
    if (!name.trim() || !cronExpr.trim() || !script.trim()) {
      toast.error("Name, schedule, and script are required");
      return;
    }
    setSaving(true);
    try {
      if (editTask) {
        await updateScheduledTask(editTask.id, { name: name.trim(), cron_expr: cronExpr.trim(), timezone: timezone || undefined, script: script.trim() });
        toast.success("Task updated");
      } else {
        await createScheduledTask({ name: name.trim(), cron_expr: cronExpr.trim(), timezone: timezone || undefined, script: script.trim() });
        toast.success("Task created");
      }
      qc.invalidateQueries({ queryKey: ["scheduled-tasks"] });
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to save task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium">{editTask ? "Edit Schedule" : "Create Schedule"}</DialogTitle>
          <DialogDescription className="text-xs">
            {editTask ? "Update your scheduled task." : "Create a schedule to run a task at a specific time or interval."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          {/* Task Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground">Task Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Daily Database Backup"
              className="text-xs"
            />
            <p className="text-[11px] text-muted-foreground">A descriptive name for your scheduled task</p>
          </div>

          {/* Schedule */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground">Schedule</label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between text-xs h-9 font-normal">
                  <span className={cronPreset ? "text-foreground" : "text-muted-foreground"}>
                    {cronPreset
                      ? CRON_PRESETS.find((p) => p.value === cronPreset)?.label ?? "Custom"
                      : "Select a predefined schedule"}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[460px]">
                {CRON_PRESETS.map((p) => (
                  <DropdownMenuItem
                    key={p.value}
                    className="text-xs font-mono"
                    onClick={() => {
                      setCronPreset(p.value);
                      if (p.value !== "custom") setCronCustom(p.value);
                    }}
                  >
                    {p.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {(cronPreset === "custom" || cronPreset === "") && (
              <Input
                value={cronCustom}
                onChange={(e) => setCronCustom(e.target.value)}
                placeholder="Custom cron expression (e.g., 0 0 * * *)"
                className="text-xs font-mono mt-1"
              />
            )}
            <p className="text-[11px] text-muted-foreground">Choose a predefined schedule or enter a custom cron expression</p>
          </div>

          {/* Timezone */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground">Timezone <span className="font-normal text-muted-foreground">(optional)</span></label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between text-xs h-9 font-normal">
                  <span className={timezone ? "text-foreground font-mono" : "text-muted-foreground"}>
                    {timezone || "Optional: Choose a timezone"}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[460px]">
                <DropdownMenuItem className="text-xs" onClick={() => setTimezone("")}>
                  <span className="text-muted-foreground">— None (server default) —</span>
                </DropdownMenuItem>
                {TIMEZONES.map((tz) => (
                  <DropdownMenuItem key={tz} className="text-xs font-mono" onClick={() => setTimezone(tz)}>{tz}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Script */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground">Script</label>
            <Textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder={"#!/bin/bash\n# Your script here\necho 'Hello from scheduler'"}
              className="text-xs font-mono min-h-[120px] resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className={`h-8 text-xs ${GREEN_BTN}`}
            onClick={handleSave}
            disabled={saving || !name.trim() || !cronExpr.trim() || !script.trim()}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
            {editTask ? "Save Changes" : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskCard({ task, onEdit, onLogs }: { task: ScheduledTask; onEdit: (t: ScheduledTask) => void; onLogs: (t: ScheduledTask) => void }) {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [toggling, setToggling] = useState(false);

  async function handleRun() {
    setRunning(true);
    try {
      await runScheduledTask(task.id);
      toast.success(`"${task.name}" started manually`);
      qc.invalidateQueries({ queryKey: ["task-runs", task.id] });
    } catch (err: any) {
      toast.error(err.message || "Failed to run task");
    } finally {
      setRunning(false);
    }
  }

  async function handleToggle() {
    setToggling(true);
    try {
      await updateScheduledTask(task.id, { enabled: !task.enabled });
      qc.invalidateQueries({ queryKey: ["scheduled-tasks"] });
      toast.success(task.enabled ? "Task disabled" : "Task enabled");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteScheduledTask(task.id);
      qc.invalidateQueries({ queryKey: ["scheduled-tasks"] });
      toast.success(`"${task.name}" deleted`);
    } catch (err: any) {
      toast.error(err.message || "Failed to delete");
    }
  }

  return (
    <Card className="bg-background border-border shadow-none rounded-xl">
      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
        {/* Left: info */}
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground truncate">{task.name}</span>
            <Badge
              variant="outline"
              className={`text-[10px] rounded-full px-2 py-0 font-mono uppercase inline-flex items-center gap-1 cursor-pointer select-none ${
                task.enabled
                  ? "text-primary bg-primary/10 border-primary/20"
                  : "text-muted-foreground bg-muted/50 border-border"
              }`}
              onClick={handleToggle}
            >
              {toggling ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : (
                <span className={`w-1.5 h-1.5 rounded-full ${task.enabled ? "bg-primary" : "bg-muted-foreground"}`} />
              )}
              {task.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-[11px] text-muted-foreground font-mono bg-muted/40 px-1.5 py-0.5 rounded">
              {task.cron_expr}
            </code>
            {task.timezone && (
              <span className="text-[11px] text-muted-foreground">{task.timezone}</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/60 font-mono truncate">{task.script.split("\n")[0]}</p>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-muted/60"
            onClick={handleRun}
            disabled={running}
            title="Run now"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-muted/60"
            onClick={() => onLogs(task)}
            title="View run logs"
          >
            <FileText className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-muted/60"
            onClick={() => onEdit(task)}
            title="Edit"
          >
            <Edit2 className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="w-8 h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={handleDelete}
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SchedulerPage() {
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const { data, isLoading } = useGetScheduledTasks();
  const tasks = data?.tasks || [];

  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<ScheduledTask | null>(null);
  const [logsTask, setLogsTask] = useState<ScheduledTask | null>(null);

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
                  <Clock className="w-4 h-4 text-primary" />
                </div>
                <span className="font-medium text-sm tracking-tight text-foreground">Scheduler</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60" onClick={toggle}>
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
              <Button variant="outline" size="sm" className="h-8 rounded-full text-xs" onClick={() => qc.invalidateQueries({ queryKey: ["scheduled-tasks"] })}>
                <RefreshCw className="w-3.5 h-3.5 mr-2" />Refresh
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-8 space-y-6 pb-24 max-w-4xl w-full mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h1 className="text-4xl sm:text-5xl font-normal tracking-tight text-foreground leading-none">Scheduled Tasks</h1>
              <p className="text-muted-foreground text-sm mt-2 max-w-xl leading-relaxed">
                Schedule tasks to run automatically at specified intervals.
              </p>
            </div>
            <Button
              className={`h-9 shrink-0 gap-2 ${GREEN_BTN}`}
              onClick={() => { setEditTask(null); setCreateOpen(true); }}
            >
              <Plus className="w-4 h-4" /> New Task
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading tasks…</span>
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
              <div className="p-4 rounded-2xl bg-muted/40 border border-border">
                <CalendarClock className="w-10 h-10 text-muted-foreground/40" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No scheduled tasks</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">Create your first scheduled task to automate your workflows</p>
              </div>
              <Button
                className={`h-9 gap-2 ${GREEN_BTN}`}
                onClick={() => { setEditTask(null); setCreateOpen(true); }}
              >
                <Plus className="w-4 h-4" /> Create Scheduled Task
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onEdit={(t) => { setEditTask(t); setCreateOpen(true); }}
                  onLogs={(t) => setLogsTask(t)}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      <CreateEditDialog
        open={createOpen}
        onClose={() => { setCreateOpen(false); setEditTask(null); }}
        editTask={editTask}
      />

      {logsTask && (
        <TaskLogsDialog
          task={logsTask}
          open={!!logsTask}
          onClose={() => setLogsTask(null)}
        />
      )}
    </div>
  );
}
