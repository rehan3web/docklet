import { copyToClipboard } from "@/lib/utils";
import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Globe, CheckCircle, XCircle, Copy, Loader2, RefreshCw, Trash2, Zap, Code2, ChevronDown, ChevronUp, ShieldCheck, ExternalLink } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useGetBaseDomain, baseDomainSave,
  containerDomainGet, containerDomainAssign, containerDomainNginx,
  containerDomainDelete, containerDomainRegenerate,
  containerDomainTraefik, traefikComposeSnippet,
  useGetVerifiedDomains,
  type ContainerDomain, type VerifiedDomain,
} from "@/api/client";

interface Props { containerName: string; open: boolean; onClose: () => void }

export default function DomainDialog({ containerName, open, onClose }: Props) {
  const qc = useQueryClient();
  const { data: baseData } = useGetBaseDomain();
  const baseCfg = baseData?.config || null;
  const { data: domainsData } = useGetVerifiedDomains();
  const verifiedDomains: VerifiedDomain[] = (domainsData?.domains ?? []).filter(d => d.verified);

  const [domain, setDomain] = useState<ContainerDomain | null>(null);
  const [loading, setLoading] = useState(false);

  // Step 1: domain picker
  const [selectedDomainId, setSelectedDomainId] = useState<number | "">("");
  const [savingBase, setSavingBase] = useState(false);

  const [port, setPort] = useState("");
  const [customSub, setCustomSub] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [enablingNginx, setEnablingNginx] = useState(false);
  const [enablingTraefik, setEnablingTraefik] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [traefikSnippet, setTraefikSnippet] = useState<string | null>(null);
  const [showSnippet, setShowSnippet] = useState(false);
  const [snippetEmail, setSnippetEmail] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    containerDomainGet(containerName)
      .then(r => { setDomain(r.domain); })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, [open, containerName]);

  // Pre-select the base domain if it matches one of the verified domains
  useEffect(() => {
    if (baseCfg?.domain && verifiedDomains.length > 0 && selectedDomainId === "") {
      const match = verifiedDomains.find(d => d.domain === baseCfg.domain);
      if (match) setSelectedDomainId(match.id);
    }
  }, [baseCfg, verifiedDomains]);

  const selectedVd = verifiedDomains.find(d => d.id === selectedDomainId) ?? null;
  const baseVerified = !!selectedVd || !!baseCfg?.verified;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["base-domain"] });
    containerDomainGet(containerName).then(r => setDomain(r.domain)).catch(() => {});
  };

  async function handleSelectDomain(id: number | "") {
    setSelectedDomainId(id);
    if (id === "") return;
    const vd = verifiedDomains.find(d => d.id === id);
    if (!vd) return;
    setSavingBase(true);
    try {
      await baseDomainSave(vd.domain, vd.vps_ip);
      qc.invalidateQueries({ queryKey: ["base-domain"] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingBase(false);
    }
  }

  async function handleAssign() {
    if (!port) { toast.error("Port is required"); return; }
    setAssigning(true);
    try {
      const r = await containerDomainAssign(containerName, parseInt(port), customSub.trim() || undefined) as any;
      setDomain(r.domain);
      toast.success("Domain assigned");
    } catch (err: any) { toast.error(err.message); }
    finally { setAssigning(false); }
  }

  async function handleEnableNginx() {
    setEnablingNginx(true);
    try {
      await containerDomainNginx(containerName);
      toast.success("Nginx configured and reloaded");
      refresh();
    } catch (err: any) { toast.error(err.message); }
    finally { setEnablingNginx(false); }
  }

  async function handleEnableTraefik() {
    if (!confirm("This will stop, remove and recreate the container with Traefik labels. Continue?")) return;
    setEnablingTraefik(true);
    try {
      await containerDomainTraefik(containerName);
      toast.success("Traefik labels applied — container restarting in background");
      refresh();
    } catch (err: any) { toast.error(err.message); }
    finally { setEnablingTraefik(false); }
  }

  async function loadTraefikSnippet() {
    try {
      const r = await traefikComposeSnippet(snippetEmail || undefined);
      setTraefikSnippet(r.snippet);
      setShowSnippet(true);
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const r = await containerDomainRegenerate(containerName) as any;
      setDomain(r.domain);
      toast.success("Domain regenerated");
    } catch (err: any) { toast.error(err.message); }
    finally { setRegenerating(false); }
  }

  async function handleDelete() {
    try {
      await containerDomainDelete(containerName);
      setDomain(null);
      toast.success("Domain removed");
    } catch (err: any) { toast.error(err.message); }
  }

  function copy(text: string) {
    copyToClipboard(text).then(() => toast.success("Copied!"));
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[620px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-5 pb-3 border-b border-border">
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <Globe className="w-4 h-4 text-muted-foreground" />
            Domain — {containerName}
          </DialogTitle>
          <DialogDescription className="text-xs">Route a subdomain to this container via nginx or Traefik.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[520px] overflow-y-auto p-4 space-y-4">

          {/* ── Step 1: Choose verified base domain ── */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Step 1 — Base Domain</span>
              {baseVerified && (
                <Badge className="text-[10px] py-0 px-1.5 rounded-full bg-emerald-500/15 text-emerald-500 border-emerald-500/30 gap-1">
                  <ShieldCheck className="w-3 h-3" />Verified
                </Badge>
              )}
            </div>
            <div className="p-4 space-y-3">
              {verifiedDomains.length === 0 ? (
                <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    No verified domains yet. Add and verify a domain first.
                  </p>
                  <Link href="/domains" onClick={onClose}>
                    <button className="text-xs text-primary hover:underline flex items-center gap-1 ml-3 shrink-0">
                      Go to Domains <ExternalLink className="w-3 h-3" />
                    </button>
                  </Link>
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">Select a verified domain to use as the base for this container's subdomain.</p>
                  <div className="relative">
                    <select
                      value={selectedDomainId}
                      onChange={e => handleSelectDomain(e.target.value === "" ? "" : Number(e.target.value))}
                      className="w-full h-8 text-xs rounded-md border border-input bg-background px-3 pr-8 appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">— Select a domain —</option>
                      {verifiedDomains.map(d => (
                        <option key={d.id} value={d.id}>{d.domain}</option>
                      ))}
                    </select>
                    {savingBase && (
                      <Loader2 className="w-3 h-3 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    )}
                  </div>
                  {selectedVd && (
                    <div className="font-mono text-[11px] text-muted-foreground space-y-0.5 bg-muted/40 rounded-lg px-3 py-2">
                      <div>A &nbsp;<span className="text-foreground/50">@</span>&nbsp; → <span className="text-foreground">{selectedVd.vps_ip}</span></div>
                      <div>A &nbsp;<span className="text-foreground/50">*</span>&nbsp; → <span className="text-foreground">{selectedVd.vps_ip}</span></div>
                    </div>
                  )}
                  {!selectedVd && baseCfg?.verified && (
                    <p className="text-[11px] text-muted-foreground">
                      Currently using: <span className="font-mono text-foreground">{baseCfg.domain}</span>
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── Step 2: Assign subdomain ── */}
          <div className={`rounded-xl border overflow-hidden transition-opacity ${!baseVerified ? "opacity-50 pointer-events-none" : "border-border"}`}>
            <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Step 2 — Assign Subdomain</span>
            </div>
            <div className="p-4 space-y-3">
              {domain ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-muted/20">
                    <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="font-mono text-xs flex-1 break-all">{domain.full_domain}</span>
                    <button onClick={() => copy(`http://${domain.full_domain}`)} className="text-muted-foreground hover:text-foreground p-1">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleRegenerate} disabled={regenerating}
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                      {regenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      Regenerate
                    </button>
                    <span className="text-muted-foreground text-[11px]">·</span>
                    <button onClick={handleDelete} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="w-3 h-3" />Remove
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Port: <span className="font-mono text-foreground">{domain.port}</span></span>
                    <Badge variant="outline" className={`text-[10px] rounded-full px-2 py-0 ${domain.nginx_enabled ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/10" : "text-muted-foreground"}`}>
                      nginx {domain.nginx_enabled ? "active" : "not applied"}
                    </Badge>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Enter the container's exposed port and optionally a custom subdomain.</p>
                  <div className="flex gap-2">
                    <Input placeholder="Port (e.g. 3000)" value={port} onChange={e => setPort(e.target.value)} className="h-8 text-xs w-32 shrink-0" type="number" />
                    <Input placeholder="Subdomain (optional, auto-generated)" value={customSub} onChange={e => setCustomSub(e.target.value)} className="h-8 text-xs flex-1" />
                  </div>
                  {selectedVd && customSub && (
                    <p className="text-[11px] text-muted-foreground font-mono">
                      → <span className="text-foreground">{customSub}.{selectedVd.domain}</span>
                    </p>
                  )}
                  <Button size="sm" className="h-8 text-xs w-full bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none"
                    onClick={handleAssign} disabled={assigning || !port}>
                    {assigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Generate Domain"}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* ── Step 3: Choose routing engine ── */}
          {domain && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Step 3 — Activate Routing</span>
                {(domain as any).routing_mode && (domain as any).routing_mode !== 'none' && (
                  <Badge className={`text-[10px] py-0 px-1.5 rounded-full ${
                    (domain as any).routing_mode === 'traefik'
                      ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
                      : "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                  }`}>
                    {(domain as any).routing_mode}
                  </Badge>
                )}
              </div>
              <div className="p-4 space-y-3">
                {(domain as any).traefik_enabled && (
                  <div className="flex items-center gap-2 text-xs text-purple-400 mb-1">
                    <CheckCircle className="w-4 h-4" />
                    <span>Traefik is routing <span className="font-mono">{domain.full_domain}</span> → port {domain.port}</span>
                  </div>
                )}
                {domain.nginx_enabled && !(domain as any).traefik_enabled && (
                  <div className="flex items-center gap-2 text-xs text-emerald-500 mb-1">
                    <CheckCircle className="w-4 h-4" />
                    <span>Nginx is routing <span className="font-mono">{domain.full_domain}</span> → port {domain.port}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <div className="text-xs font-medium flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-muted-foreground" />Nginx</div>
                    <p className="text-[11px] text-muted-foreground">Write config file to shared volume and reload nginx.</p>
                    <Button size="sm" variant="outline" className="h-7 text-xs w-full"
                      onClick={handleEnableNginx} disabled={enablingNginx}>
                      {enablingNginx ? <Loader2 className="w-3 h-3 animate-spin" /> : domain.nginx_enabled ? "Re-apply" : "Activate"}
                    </Button>
                  </div>

                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <div className="text-xs font-medium flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                      Traefik
                      <Badge className="text-[9px] py-0 px-1 rounded-full bg-purple-500/15 text-purple-400 border-purple-500/30 ml-auto">Labels</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Recreate container with Traefik Docker labels. Requires Traefik running.</p>
                    <Button size="sm" variant="outline" className="h-7 text-xs w-full"
                      onClick={handleEnableTraefik} disabled={enablingTraefik}>
                      {enablingTraefik ? <Loader2 className="w-3 h-3 animate-spin" /> : (domain as any).traefik_enabled ? "Re-apply" : "Activate"}
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border border-border/50 bg-muted/10 overflow-hidden">
                  <button
                    className="flex items-center gap-2 w-full px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => showSnippet ? setShowSnippet(false) : loadTraefikSnippet()}
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    <span>Traefik setup — compose snippet</span>
                    {showSnippet ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
                  </button>
                  {showSnippet && traefikSnippet && (
                    <div className="px-3 pb-3 space-y-2">
                      <div className="flex gap-2 items-center">
                        <Input placeholder="ACME email" value={snippetEmail} onChange={e => setSnippetEmail(e.target.value)} className="h-7 text-xs flex-1" />
                        <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={loadTraefikSnippet}>Refresh</Button>
                      </div>
                      <pre className="bg-muted rounded-lg p-2.5 text-[10px] font-mono text-foreground overflow-x-auto whitespace-pre leading-relaxed">{traefikSnippet}</pre>
                      <p className="text-[10px] text-muted-foreground">Add this to your <code className="font-mono">postgres.yml</code> and run: <code className="font-mono">docker network create proxy</code></p>
                    </div>
                  )}
                </div>
              </div>
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
