import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Globe, CheckCircle, XCircle, Copy, Loader2, RefreshCw, Trash2, Zap } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBaseDomain, baseDomainSave, baseDomainVerify,
  containerDomainGet, containerDomainAssign, containerDomainNginx,
  containerDomainDelete, containerDomainRegenerate,
  type ContainerDomain, type BaseDomainConfig,
} from "@/api/client";

interface Props { containerName: string; open: boolean; onClose: () => void }

export default function DomainDialog({ containerName, open, onClose }: Props) {
  const qc = useQueryClient();
  const { data: baseData } = useGetBaseDomain();
  const baseCfg = baseData?.config || null;

  const [domain, setDomain] = useState<ContainerDomain | null>(null);
  const [loading, setLoading] = useState(false);

  const [baseDomainInput, setBaseDomainInput] = useState("");
  const [vpsIpInput, setVpsIpInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);

  const [port, setPort] = useState("");
  const [customSub, setCustomSub] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [enablingNginx, setEnablingNginx] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    containerDomainGet(containerName)
      .then(r => { setDomain(r.domain); })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, [open, containerName]);

  useEffect(() => {
    if (baseCfg) {
      setBaseDomainInput(baseCfg.domain || "");
      setVpsIpInput(baseCfg.vps_ip || "");
    }
  }, [baseCfg]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["base-domain"] });
    containerDomainGet(containerName).then(r => setDomain(r.domain)).catch(() => {});
  };

  async function handleSaveBase() {
    if (!baseDomainInput.trim() || !vpsIpInput.trim()) return;
    try {
      await baseDomainSave(baseDomainInput.trim(), vpsIpInput.trim());
      toast.success("Domain saved");
      qc.invalidateQueries({ queryKey: ["base-domain"] });
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleVerify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const r = await baseDomainVerify();
      setVerifyResult(r);
      qc.invalidateQueries({ queryKey: ["base-domain"] });
      if (r.verified) toast.success("Domain verified!");
      else toast.warning("DNS not propagated yet — try again in a few minutes");
    } catch (err: any) { toast.error(err.message); }
    finally { setVerifying(false); }
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
    navigator.clipboard.writeText(text).then(() => toast.success("Copied!"));
  }

  const baseVerified = baseCfg?.verified;

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[620px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-5 pb-3 border-b border-border">
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <Globe className="w-4 h-4 text-muted-foreground" />
            Domain — {containerName}
          </DialogTitle>
          <DialogDescription className="text-xs">Route a subdomain to this container via nginx.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[520px] overflow-y-auto p-4 space-y-4">

          {/* ── Step 1: Base domain ── */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Step 1 — Base Domain</span>
              {baseVerified && <Badge className="text-[10px] py-0 px-1.5 rounded-full bg-emerald-500/15 text-emerald-500 border-emerald-500/30">Verified</Badge>}
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">Add these DNS records at your registrar, then click Verify:</p>
              <div className="bg-muted/50 rounded-lg p-3 font-mono text-[11px] text-foreground space-y-1">
                <div>A &nbsp;&nbsp;<span className="text-muted-foreground">@</span>&nbsp;&nbsp;→ <span className="text-primary">{vpsIpInput || "YOUR.VPS.IP"}</span></div>
                <div>A &nbsp;&nbsp;<span className="text-muted-foreground">*</span>&nbsp;&nbsp;→ <span className="text-primary">{vpsIpInput || "YOUR.VPS.IP"}</span></div>
              </div>
              <div className="flex gap-2">
                <Input placeholder="yourdomain.com" value={baseDomainInput} onChange={e => setBaseDomainInput(e.target.value)} className="h-8 text-xs flex-1" />
                <Input placeholder="VPS IP" value={vpsIpInput} onChange={e => setVpsIpInput(e.target.value)} className="h-8 text-xs w-36" />
                <Button variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={handleSaveBase}>Save</Button>
              </div>
              <Button
                variant="outline" size="sm" className="h-8 text-xs w-full"
                onClick={handleVerify} disabled={verifying || !baseDomainInput.trim()}
              >
                {verifying ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />Checking DNS…</> : "Verify DNS"}
              </Button>
              {verifyResult && (
                <div className="text-[11px] space-y-1">
                  <div className="flex items-center gap-1.5">
                    {verifyResult.apexOk ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 text-destructive" />}
                    <span>Apex ({baseDomainInput}) → {verifyResult.apexIps.join(", ") || "not resolved"}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {verifyResult.wildcardOk ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 text-destructive" />}
                    <span>Wildcard (*.{baseDomainInput}) → {verifyResult.wildcardIps.join(", ") || "not resolved"}</span>
                  </div>
                </div>
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
                  <Button size="sm" className="h-8 text-xs w-full bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none"
                    onClick={handleAssign} disabled={assigning || !port}>
                    {assigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Generate Domain"}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* ── Step 3: Enable nginx ── */}
          {domain && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Step 3 — Activate Nginx</span>
              </div>
              <div className="p-4">
                {domain.nginx_enabled ? (
                  <div className="flex items-center gap-2 text-xs text-emerald-500">
                    <CheckCircle className="w-4 h-4" />
                    <span>Nginx is routing <span className="font-mono">{domain.full_domain}</span> → port {domain.port}</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Write the nginx config and reload to activate this domain.</p>
                    <Button size="sm" className="h-8 text-xs w-full bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none"
                      onClick={handleEnableNginx} disabled={enablingNginx}>
                      {enablingNginx ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />Applying…</> : <><Zap className="w-3.5 h-3.5 mr-1" />Activate Nginx</>}
                    </Button>
                  </div>
                )}
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
