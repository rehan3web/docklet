import React, { useState } from "react";
import { Sun, Moon, Container, Play, Square, RotateCw, Trash2, RefreshCw, AlertTriangle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { useGetDockerStatus, useGetDockerContainers, dockerStart, dockerStop, dockerRestart, dockerRemove, dockerBulk } from "@/api/client";
import { useQueryClient } from "@tanstack/react-query";

export default function DockerPage() {
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const { data: status } = useGetDockerStatus();
  const { data: containersData, isLoading } = useGetDockerContainers();
  const [bulkAction, setBulkAction] = useState<"start" | "stop" | "restart" | "remove" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["docker-containers"] });
    qc.invalidateQueries({ queryKey: ["docker-status"] });
  };

  async function action(id: string, fn: (id: string) => Promise<void>, label: string) {
    setBusy(id);
    try {
      await fn(id);
      toast.success(`${label} succeeded`);
      refresh();
    } catch (err: any) {
      toast.error(err.message || `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  async function runBulk() {
    if (!bulkAction) return;
    try {
      const r = await dockerBulk(bulkAction);
      const failed = r.results.filter(x => !x.ok).length;
      if (failed) toast.warning(`${bulkAction} completed with ${failed} failure(s)`);
      else toast.success(`Bulk ${bulkAction} succeeded`);
      refresh();
    } catch (err: any) {
      toast.error(err.message || "Bulk action failed");
    } finally {
      setBulkAction(null);
    }
  }

  const containers = containersData?.containers || [];
  const dockerOk = status?.available !== false;

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
                  <Container className="w-4 h-4 text-primary" />
                </div>
                <span className="font-medium text-sm tracking-tight text-foreground">Docker Manager</span>
                {status?.available && (
                  <Badge variant="outline" className="font-mono text-[10px] uppercase rounded-full px-2 py-0 text-primary bg-primary/10 border-primary/20">
                    {status.serverVersion}
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
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-8 space-y-6 pb-24 max-w-6xl w-full mx-auto">
          <div className="flex flex-col gap-2 mb-4">
            <h1 className="text-4xl sm:text-5xl font-normal tracking-tight text-foreground leading-none">Docker Manager</h1>
            <p className="text-muted-foreground text-sm max-w-xl leading-relaxed">
              Manage containers running on the host: start, stop, restart, or remove containers individually or in bulk.
            </p>
          </div>

          {!dockerOk && (
            <Card className="bg-amber-500/10 border-amber-500/30 shadow-none rounded-xl">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1 text-sm">
                  <p className="font-medium text-foreground mb-1">Docker is not available</p>
                  <p className="text-xs text-muted-foreground">{status?.reason || "The Docker socket is not reachable. Install Docker on your VPS to enable this feature."}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {dockerOk && status && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total Containers" value={String(status.containers ?? 0)} />
              <StatCard label="Running" value={String(status.running ?? 0)} />
              <StatCard label="Stopped" value={String(status.stopped ?? 0)} />
              <StatCard label="Images" value={String(status.images ?? 0)} />
            </div>
          )}

          {/* Bulk actions */}
          <Card className="bg-background border-border shadow-none rounded-xl">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium tracking-tight">Bulk Actions</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">Apply an action to all containers at once.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-2 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={!dockerOk} onClick={() => setBulkAction("start")}>
                <Play className="w-3.5 h-3.5 mr-1" />Start All
              </Button>
              <Button variant="outline" size="sm" disabled={!dockerOk} onClick={() => setBulkAction("stop")}>
                <Square className="w-3.5 h-3.5 mr-1" />Stop All
              </Button>
              <Button variant="outline" size="sm" disabled={!dockerOk} onClick={() => setBulkAction("restart")}>
                <RotateCw className="w-3.5 h-3.5 mr-1" />Restart All
              </Button>
              <Button variant="destructive" size="sm" disabled={!dockerOk} onClick={() => setBulkAction("remove")}>
                <Trash2 className="w-3.5 h-3.5 mr-1" />Remove All
              </Button>
            </CardContent>
          </Card>

          {/* Containers table */}
          <Card className="bg-background border-border shadow-none rounded-xl overflow-hidden">
            <CardHeader className="p-4 pb-3 border-b border-border/50">
              <CardTitle className="text-sm font-medium tracking-tight">Containers</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-xs font-medium text-muted-foreground px-6">NAME</TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground px-6">IMAGE</TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground px-6">STATE</TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground px-6">CREATED</TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground px-6 text-right">ACTIONS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={5} className="px-6"><Skeleton className="h-4 w-full bg-muted" /></TableCell></TableRow>
                  ))
                ) : containers.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">{dockerOk ? "No containers" : "Docker is not available."}</TableCell></TableRow>
                ) : (
                  containers.map((c) => (
                    <TableRow key={c.id} className="border-border hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono text-xs text-foreground px-6 truncate">{c.names[0] || c.shortId}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground px-6 truncate">{c.image}</TableCell>
                      <TableCell className="px-6">
                        <Badge variant="outline" className={`font-mono text-[10px] uppercase rounded-full px-2 py-0 ${c.state === 'running' ? 'text-primary bg-primary/10 border-primary/20' : 'text-muted-foreground bg-muted/50'}`}>
                          {c.state}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground px-6 whitespace-nowrap">{format(new Date(c.createdAt), "MMM dd, HH:mm")}</TableCell>
                      <TableCell className="px-6 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {busy === c.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground mr-1" />}
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={c.state === 'running' || busy === c.id} title="Start" onClick={() => action(c.id, dockerStart, "Start")}>
                            <Play className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={c.state !== 'running' || busy === c.id} title="Stop" onClick={() => action(c.id, dockerStop, "Stop")}>
                            <Square className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={busy === c.id} title="Restart" onClick={() => action(c.id, dockerRestart, "Restart")}>
                            <RotateCw className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" disabled={busy === c.id} title="Remove" onClick={() => action(c.id, dockerRemove, "Remove")}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </main>
      </div>

      <AlertDialog open={!!bulkAction} onOpenChange={(o) => { if (!o) setBulkAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm bulk {bulkAction}</AlertDialogTitle>
            <AlertDialogDescription>
              This will {bulkAction} <span className="font-semibold">all</span> containers on the host. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runBulk}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="bg-background border-border shadow-none rounded-lg">
      <CardContent className="p-5">
        <p className="text-xs font-medium text-muted-foreground tracking-wide mb-2">{label}</p>
        <p className="text-2xl font-normal tracking-tight text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}
