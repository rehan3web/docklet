import React, { useEffect, useState } from "react";
import { Plus, Trash2, CheckCircle, XCircle, Loader2, RefreshCw, Globe, Copy, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { Sun, Moon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetVerifiedDomains, addVerifiedDomain, deleteVerifiedDomain,
  verifyVerifiedDomain, getDomainsServerIp, type VerifiedDomain,
} from "@/api/client";

export default function DomainsPage() {
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const { data, isLoading } = useGetVerifiedDomains();
  const domains = data?.domains ?? [];
  const [serverIp, setServerIp] = useState(data?.serverIp ?? "");

  const [showAdd, setShowAdd] = useState(false);
  const [domainInput, setDomainInput] = useState("");
  const [ipInput, setIpInput] = useState("");
  const [adding, setAdding] = useState(false);

  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<number, any>>({});
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (data?.serverIp && !serverIp) setServerIp(data.serverIp);
  }, [data?.serverIp]);

  useEffect(() => {
    getDomainsServerIp().then(r => { if (r.ip) setServerIp(r.ip); }).catch(() => {});
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!domainInput.trim()) return;
    setAdding(true);
    try {
      await addVerifiedDomain(domainInput.trim().toLowerCase(), ipInput.trim() || serverIp);
      toast.success("Domain added");
      qc.invalidateQueries({ queryKey: ["verified-domains"] });
      setDomainInput("");
      setIpInput("");
      setShowAdd(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleVerify(d: VerifiedDomain) {
    setVerifyingId(d.id);
    setVerifyResults(prev => ({ ...prev, [d.id]: null }));
    try {
      const r = await verifyVerifiedDomain(d.id);
      setVerifyResults(prev => ({ ...prev, [d.id]: r }));
      qc.invalidateQueries({ queryKey: ["verified-domains"] });
      if (r.verified) toast.success(`${d.domain} verified!`);
      else toast.warning("DNS not propagated yet — try again in a few minutes");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleDelete(d: VerifiedDomain) {
    if (!confirm(`Remove ${d.domain}?`)) return;
    setDeletingId(d.id);
    try {
      await deleteVerifiedDomain(d.id);
      toast.success("Domain removed");
      qc.invalidateQueries({ queryKey: ["verified-domains"] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => toast.success("Copied!"));
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <DesktopSidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border/60 shrink-0">
          <MobileSidebarTrigger />
          <Globe className="w-4 h-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold text-foreground">Domains</h1>
          <span className="text-muted-foreground text-xs hidden sm:block">
            Verify domains once — use everywhere
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline" size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setShowAdd(v => !v)}
            >
              <Plus className="w-3.5 h-3.5" />
              Add Domain
            </Button>
            <button onClick={toggle} className="p-2 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground">
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto space-y-4">

            {/* Server IP info */}
            {serverIp && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border text-xs text-muted-foreground">
                <span>Your VPS IP:</span>
                <code className="font-mono text-foreground">{serverIp}</code>
                <button onClick={() => copy(serverIp)} className="hover:text-foreground transition-colors">
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Add domain form */}
            {showAdd && (
              <form onSubmit={handleAdd} className="rounded-xl border border-border bg-card p-4 space-y-3">
                <p className="text-xs font-medium text-foreground">Add a domain</p>
                <p className="text-xs text-muted-foreground">
                  Point your domain's A records to your VPS IP before verifying.
                </p>
                <div className="bg-muted/50 rounded-lg p-3 font-mono text-[11px] text-foreground space-y-1">
                  <div>A &nbsp;&nbsp;<span className="text-muted-foreground">@</span>&nbsp;&nbsp;→ <span className="text-primary">{ipInput || serverIp || "YOUR.VPS.IP"}</span></div>
                  <div>A &nbsp;&nbsp;<span className="text-muted-foreground">*</span>&nbsp;&nbsp;→ <span className="text-primary">{ipInput || serverIp || "YOUR.VPS.IP"}</span></div>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="yourdomain.com"
                    value={domainInput}
                    onChange={e => setDomainInput(e.target.value)}
                    className="h-8 text-xs flex-1"
                    required
                  />
                  <Input
                    placeholder={serverIp || "VPS IP (auto-detected)"}
                    value={ipInput}
                    onChange={e => setIpInput(e.target.value)}
                    className="h-8 text-xs w-44"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    className="h-8 text-xs bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none"
                    disabled={adding}
                  >
                    {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Add Domain"}
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowAdd(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}

            {/* Domain list */}
            {isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading domains…
              </div>
            ) : domains.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <Globe className="w-10 h-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No domains added yet.</p>
                <p className="text-xs text-muted-foreground/70">
                  Add a domain and verify it. Verified domains can be used in Containers, Reverse Proxy, and Storage.
                </p>
                <Button variant="outline" size="sm" className="h-8 text-xs mt-1" onClick={() => setShowAdd(true)}>
                  <Plus className="w-3.5 h-3.5 mr-1" />Add your first domain
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {domains.map(d => {
                  const result = verifyResults[d.id];
                  return (
                    <div key={d.id} className="rounded-xl border border-border bg-card overflow-hidden">
                      {/* Domain header */}
                      <div className="flex items-center gap-3 px-4 py-3">
                        <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="font-mono text-sm text-foreground flex-1">{d.domain}</span>
                        {d.verified ? (
                          <Badge className="text-[10px] py-0 px-2 rounded-full bg-emerald-500/15 text-emerald-500 border-emerald-500/30 gap-1">
                            <ShieldCheck className="w-3 h-3" />Verified
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] py-0 px-2 rounded-full text-amber-500 border-amber-500/30 bg-amber-500/10">
                            Unverified
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          disabled={verifyingId === d.id}
                          onClick={() => handleVerify(d)}
                        >
                          {verifyingId === d.id
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <RefreshCw className="w-3 h-3" />}
                          {d.verified ? "Re-verify" : "Verify DNS"}
                        </Button>
                        <button
                          onClick={() => handleDelete(d)}
                          disabled={deletingId === d.id}
                          className="text-muted-foreground hover:text-destructive transition-colors p-1"
                        >
                          {deletingId === d.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>

                      {/* DNS records */}
                      <div className="border-t border-border/50 bg-muted/20 px-4 py-2.5">
                        <div className="font-mono text-[11px] text-muted-foreground space-y-0.5">
                          <div>
                            A &nbsp;<span className="text-foreground/50">@</span>&nbsp; → <span className="text-foreground">{d.vps_ip}</span>
                          </div>
                          <div>
                            A &nbsp;<span className="text-foreground/50">*</span>&nbsp; → <span className="text-foreground">{d.vps_ip}</span>
                          </div>
                        </div>
                      </div>

                      {/* Verification result */}
                      {result && (
                        <div className="border-t border-border/50 px-4 py-2.5 space-y-1">
                          <div className="flex items-center gap-1.5 text-[11px]">
                            {result.apexOk
                              ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                              : <XCircle className="w-3.5 h-3.5 text-destructive" />}
                            <span>Apex ({d.domain}) → {result.apexIps.join(", ") || "not resolved"}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px]">
                            {result.wildcardOk
                              ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                              : <XCircle className="w-3.5 h-3.5 text-destructive" />}
                            <span>Wildcard (*.{d.domain}) → {result.wildcardIps.join(", ") || "not resolved"}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Usage hint */}
            {domains.some(d => d.verified) && (
              <div className="rounded-xl border border-border/50 bg-muted/10 p-4 space-y-1.5">
                <p className="text-xs font-medium text-foreground">Using verified domains</p>
                <p className="text-xs text-muted-foreground">
                  Your verified domains are now available as a dropdown in:
                </p>
                <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                  <li><span className="font-medium text-foreground">Docker containers</span> — click a container → Domain button</li>
                  <li><span className="font-medium text-foreground">Reverse Proxy</span> — Add Domain → pick base domain + subdomain</li>
                  <li><span className="font-medium text-foreground">Storage</span> — Domain Setup → pick base domain + subdomain</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
