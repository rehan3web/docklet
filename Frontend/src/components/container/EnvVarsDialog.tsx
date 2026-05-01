import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, Trash2, Save, RotateCw, KeyRound, EyeOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetContainerEnv, containerEnvSet, containerEnvDelete, containerEnvApply,
  type ContainerEnvVar,
} from "@/api/client";

interface Props { containerName: string; open: boolean; onClose: () => void }

export default function EnvVarsDialog({ containerName, open, onClose }: Props) {
  const qc = useQueryClient();
  const { data, isLoading } = useGetContainerEnv(open ? containerName : "");
  const vars = data?.vars || [];

  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [applying, setApplying] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["container-env", containerName] });

  async function handleAdd() {
    if (!newKey.trim()) return;
    setAdding(true);
    try {
      await containerEnvSet(containerName, newKey.trim(), newValue);
      setNewKey(""); setNewValue("");
      toast.success("Variable saved");
      refresh();
    } catch (err: any) { toast.error(err.message); }
    finally { setAdding(false); }
  }

  async function handleDelete(id: number) {
    try {
      await containerEnvDelete(containerName, id);
      toast.success("Variable deleted");
      refresh();
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleApply() {
    setApplying(true);
    try {
      await containerEnvApply(containerName);
      toast.success("Container restarted with new environment");
      onClose();
    } catch (err: any) { toast.error(err.message); }
    finally { setApplying(false); }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[600px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-5 pb-3 border-b border-border">
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-muted-foreground" />
            Environment Variables — {containerName}
          </DialogTitle>
          <DialogDescription className="text-xs">Values are encrypted at rest. Click "Apply" to restart the container with the new env.</DialogDescription>
        </DialogHeader>

        <div className="p-4 space-y-3 max-h-[420px] overflow-y-auto">
          {/* Add row */}
          <div className="flex gap-2 items-center">
            <Input
              placeholder="KEY"
              value={newKey}
              onChange={e => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
              className="h-8 text-xs font-mono w-40 shrink-0"
            />
            <span className="text-muted-foreground text-xs shrink-0">=</span>
            <Input
              placeholder="value"
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              className="h-8 text-xs font-mono flex-1"
            />
            <Button size="sm" className="h-8 text-xs shrink-0" onClick={handleAdd} disabled={adding || !newKey.trim()}>
              <Plus className="w-3.5 h-3.5 mr-1" />Add
            </Button>
          </div>

          {/* List */}
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-9 w-full rounded-lg bg-muted" />)}
            </div>
          ) : vars.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-xs">
              No environment variables set. Add one above.
            </div>
          ) : (
            <div className="space-y-1.5">
              {vars.map((v: ContainerEnvVar) => (
                <div key={v.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/20">
                  <span className="font-mono text-xs text-foreground font-medium w-40 shrink-0 truncate">{v.key}</span>
                  <span className="text-muted-foreground text-xs">=</span>
                  <div className="flex-1 flex items-center gap-1.5 text-muted-foreground text-xs">
                    <EyeOff className="w-3 h-3 shrink-0" />
                    <span className="font-mono">••••••••</span>
                  </div>
                  <button
                    className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                    onClick={() => handleDelete(v.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {vars.length} variable{vars.length !== 1 ? "s" : ""}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              className="h-8 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none"
              onClick={handleApply}
              disabled={applying || vars.length === 0}
            >
              {applying ? <><RotateCw className="w-3.5 h-3.5 mr-1 animate-spin" />Applying…</> : <><Save className="w-3.5 h-3.5 mr-1" />Apply & Restart</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
