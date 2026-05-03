import { copyToClipboard } from "@/lib/utils";
import React, { useEffect, useRef, useState } from "react";
import { Globe, Shield, ShieldCheck, RefreshCw, Plus, Trash2, CheckCircle2, XCircle, Clock, Loader2, Sun, Moon, Copy, ChevronRight, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { useGetProxyDomains, getServerIp, createProxyDomain, verifyProxyDomain, enableProxySSL, deleteProxyDomain, reloadProxy, useGetVerifiedDomains, type ProxyDomain } from "@/api/client";
import { getSocket } from "@/api/socket";
import { useQueryClient } from "@tanstack/react-query";

type SslLog = { stream: "stdout" | "stderr" | "system"; text: string };

export default function ProxyPage() {
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const { data } = useGetProxyDomains();
  const domains = data?.domains ?? [];

  const [selected, setSelected] = useState<ProxyDomain | null>(null);
  const [serverIp, setServerIp] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);

  const { data: vdData } = useGetVerifiedDomains();
  const verifiedDomains = (vdData?.domains ?? []).filter(d => d.verified);

  const [baseDomainId, setBaseDomainId] = useState<number | "">("");
  const [subdomain, setSubdomain] = useState("");
  const [domain, setDomain] = useState("");
  const [targetPort, setTargetPort] = useState("");
  const [creating, setCreating] = useState(false);

  const selectedVd = verifiedDomains.find(d => d.id === baseDomainId) ?? null;
  const fullDomainPreview = selectedVd
    ? (subdomain.trim() ? `${subdomain.trim()}.${selectedVd.domain}` : selectedVd.domain)
    : domain;

  const [verifying, setVerifying] = useState(false);

  const [sslEmail, setSslEmail] = useState("");
  const [sslRunning, setSslRunning] = useState(false);
  const [sslLogs, setSslLogs] = useState<SslLog[]>([]);
  const [sslStatus, setSslStatus] = useState<"idle" | "running" | "success" | "failed">("idle");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getServerIp().then(r => setServerIp(r.ip)).catch(() => {});
  }, []);

  // Keep selected in sync with fresh data
  useEffect(() => {
    if (selected) {
      const fresh = domains.find(d => d.id === selected.id);
      if (fresh) setSelected(fresh);
    }
  }, [domains]);

  // Socket listeners for SSL streaming
  useEffect(() => {
    const socket = getSocket();
    const onLog = (e: { id: string; domain: string; chunk: string; stream: "stdout" | "stderr" | "system" }) => {
      if (selected && e.domain === selected.domain) {
        setSslLogs(prev => [...prev, { stream: e.stream, text: e.chunk }]);
      }
    };
    const onStatus = (e: { id: string; domain: string; status: string; message?: string }) => {
      if (selected && e.domain === selected.domain) {
        setSslStatus(e.status as any);
        if (e.status === "success") {
          toast.success(e.message || "SSL enabled!");
          setSslRunning(false);
          qc.invalidateQueries({ queryKey: ["proxy-domains"] });
        } else if (e.status === "failed") {
          toast.error(e.message || "Certbot failed");
          setSslRunning(false);
        }
      }
    };
    socket.on("ssl-log", onLog);
    socket.on("ssl-status", onStatus);
    return () => { socket.off("ssl-log", onLog); socket.off("ssl-status", onStatus); };
  }, [selected, qc]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [sslLogs.length]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const finalDomain = fullDomainPreview.trim();
    if (!finalDomain || !targetPort.trim()) return;
    setCreating(true);
    try {
      await createProxyDomain(finalDomain, Number(targetPort));
      toast.success(`${finalDomain} proxy created`);
      qc.invalidateQueries({ queryKey: ["proxy-domains"] });
      setDomain(""); setSubdomain(""); setBaseDomainId(""); setTargetPort(""); setShowCreate(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to create proxy");
    } finally { setCreating(false); }
  }

  async function handleVerify() {
    if (!selected) return;
    setVerifying(true);
    try {
      const r = await verifyProxyDomain(selected.id);
      if (r.verified) {
        toast.success("DNS verified!");
        qc.invalidateQueries({ queryKey: ["proxy-domains"] });
      }
    } catch (err: any) {
      toast.error(err.message || "DNS check failed");
    } finally { setVerifying(false); }
  }

  async function handleSSL() {
    if (!selected || !sslEmail.trim()) return;
    setSslRunning(true);
    setSslLogs([]);
    setSslStatus("running");
    try {
      await enableProxySSL(selected.id, sslEmail.trim());
    } catch (err: any) {
      toast.error(err.message || "Failed to start certbot");
      setSslRunning(false);
      setSslStatus("failed");
    }
  }

  async function handleDelete(d: ProxyDomain) {
    try {
      await deleteProxyDomain(d.id);
      toast.success(`${d.domain} removed`);
      qc.invalidateQueries({ queryKey: ["proxy-domains"] });
      if (selected?.id === d.id) setSelected(null);
    } catch (err: any) {
      toast.error(err.message || "Delete failed");
    }
  }

  async function handleReload() {
    await reloadProxy();
    toast.success("nginx reloaded");
  }

  function selectDomain(d: ProxyDomain) {
    setSelected(d);
    setSslLogs([]);
    setSslStatus("idle");
    setSslRunning(false);
  }

  const domainParts = selected ? selected.domain.split('.') : [];
  const isRoot = domainParts.length === 2;
  const subLabel = isRoot ? null : domainParts[0];

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <DesktopSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="px-4 h-18 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MobileSidebarTrigger />
              <div className="hidden lg:flex items-center gap-3">
                <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0">
                  <Globe className="w-4 h-4 text-primary" />
                </div>
                <span className="font-medium text-sm tracking-tight">Reverse Proxy</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60" onClick={toggle}>
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
              <Button variant="outline" size="sm" className="h-8 rounded-full text-xs" onClick={handleReload}>
                <RefreshCw className="w-3.5 h-3.5 mr-2" />Reload nginx
              </Button>
              <Button size="sm" className="h-8 rounded-full text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none" onClick={() => setShowCreate(v => !v)}>
                <Plus className="w-3.5 h-3.5 mr-2" />Add Domain
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-8 max-w-7xl w-full mx-auto space-y-6 pb-24">
          <div>
            <h1 className="text-4xl sm:text-5xl font-normal tracking-tight leading-none mb-2">Reverse Proxy</h1>
            <p className="text-muted-foreground text-sm max-w-xl leading-relaxed">
              Map a domain to a running container port. Docklet generates the nginx config, verifies DNS, and provisions Let's Encrypt SSL automatically.
            </p>
          </div>

          {/* Create form */}
          {showCreate && (
            <Card className="bg-background border-border shadow-none rounded-xl">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-medium">Add Reverse Proxy</CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Pick a verified domain, enter a subdomain, and the local port your app listens on.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-2">
                <form onSubmit={handleCreate} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {verifiedDomains.length > 0 ? (
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Base Domain</Label>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="w-full h-9 text-xs justify-between font-mono px-3">
                              <span className={baseDomainId === "" ? "text-muted-foreground" : ""}>{baseDomainId === "" ? "— Select —" : (verifiedDomains.find(d => d.id === baseDomainId)?.domain ?? "— Select —")}</span>
                              <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-50" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="w-full min-w-[200px] rounded-xl p-1.5 shadow-lg">
                            <DropdownMenuItem className="px-2.5 py-2 rounded-lg cursor-pointer text-xs text-muted-foreground" onClick={() => setBaseDomainId("")}>— Select —</DropdownMenuItem>
                            {verifiedDomains.map(d => (
                              <DropdownMenuItem key={d.id} className="px-2.5 py-2 rounded-lg cursor-pointer gap-2.5 text-xs font-mono" onClick={() => setBaseDomainId(d.id)}>
                                <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />{d.domain}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Domain</Label>
                        <Input value={domain} onChange={e => setDomain(e.target.value)} placeholder="app.example.com" className="font-mono text-xs h-9" />
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Subdomain {!verifiedDomains.length && "(optional)"}</Label>
                      <Input
                        value={subdomain}
                        onChange={e => setSubdomain(e.target.value)}
                        placeholder={verifiedDomains.length ? "app, api, www…" : "leave blank for root"}
                        className="font-mono text-xs h-9"
                        disabled={!verifiedDomains.length}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Target Port</Label>
                      <Input value={targetPort} onChange={e => setTargetPort(e.target.value)} placeholder="8000" type="number" min={1} max={65535} className="font-mono text-xs h-9" />
                    </div>
                  </div>
                  {fullDomainPreview && (
                    <p className="text-[11px] text-muted-foreground font-mono">
                      → <span className="text-foreground">{fullDomainPreview}</span> : {targetPort || "?"}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button type="submit" disabled={creating || !fullDomainPreview.trim() || !targetPort.trim()} className="h-9 px-5 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none">
                      {creating && <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />}Create
                    </Button>
                    <Button type="button" variant="ghost" className="h-9 px-3 text-xs" onClick={() => setShowCreate(false)}>Cancel</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
            {/* Domain list */}
            <div className="h-full">
              <Card className="bg-background border-border shadow-none rounded-xl h-full">
                <CardHeader className="p-4 pb-2 border-b border-border/50">
                  <CardTitle className="text-sm font-medium">Domains</CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">{domains.length} configured</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div>
                    {domains.length === 0 ? (
                      <div className="px-4 py-6 text-center">
                        <Globe className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
                        <p className="text-xs text-muted-foreground">No domains yet. Click "Add Domain" to get started.</p>
                      </div>
                    ) : (
                      <div className="p-2 space-y-1">
                        {domains.map(d => (
                          <button
                            key={d.id}
                            onClick={() => selectDomain(d)}
                            className={`w-full text-left p-3 rounded-lg hover:bg-muted/60 transition-colors border group ${selected?.id === d.id ? 'bg-muted/40 border-border' : 'border-transparent'}`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-mono text-xs text-foreground truncate pr-2">{d.domain}</span>
                              <ProxyStatusBadge domain={d} />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-muted-foreground">:{d.target_port}</span>
                              <ChevronRight className="w-3 h-3 text-muted-foreground/50 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Detail panel */}
            <div className="space-y-4 h-full">
              {!selected ? (
                <Card className="bg-background border-border shadow-none rounded-xl h-full flex flex-col items-center justify-center">
                  <CardContent className="px-4 py-6 text-center">
                    <Globe className="w-7 h-7 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">Select a domain to see DNS instructions and SSL setup.</p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Domain info */}
                  <Card className="bg-background border-border shadow-none rounded-xl">
                    <CardHeader className="p-4 pb-3 border-b border-border/50 flex-row items-center justify-between">
                      <div>
                        <CardTitle className="text-sm font-medium font-mono">{selected.domain}</CardTitle>
                        <CardDescription className="text-xs text-muted-foreground">Port {selected.target_port}</CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <ProxyStatusBadge domain={selected} />
                        <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(selected)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 space-y-1 text-xs text-muted-foreground">
                      {selected.ssl_enabled ? (
                        <div className="flex items-center gap-2 text-primary text-xs font-medium">
                          <ShieldCheck className="w-4 h-4" />
                          <a href={`https://${selected.domain}`} target="_blank" rel="noreferrer" className="hover:underline font-mono">
                            https://{selected.domain}
                          </a>
                        </div>
                      ) : selected.verified ? (
                        <div className="flex items-center gap-2 text-emerald-500 text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5" />DNS verified — ready for SSL
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-amber-500 text-xs">
                          <Clock className="w-3.5 h-3.5" />Waiting for DNS propagation
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* DNS Instructions */}
                  {!selected.verified && (
                    <Card className="bg-background border-border shadow-none rounded-xl">
                      <CardHeader className="p-4 pb-3 border-b border-border/50">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Globe className="w-4 h-4 text-amber-500" />
                          DNS Setup Required
                        </CardTitle>
                        <CardDescription className="text-xs text-muted-foreground">
                          Add the following DNS record(s) at your domain registrar, then click Verify.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="p-4 space-y-3">
                        {serverIp && (
                          <div className="flex items-center gap-2 p-2 bg-muted/40 rounded text-xs font-mono">
                            <span className="text-muted-foreground">Server IP:</span>
                            <span className="text-foreground font-semibold">{serverIp}</span>
                            <Button variant="ghost" size="icon" className="w-5 h-5 ml-auto text-muted-foreground" onClick={() => { copyToClipboard(serverIp); toast.success("Copied!"); }}>
                              <Copy className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                        <div className="space-y-2">
                          {isRoot ? (
                            <>
                              <DnsRecord name="@" type="A" value={serverIp || "YOUR_SERVER_IP"} />
                              <DnsRecord name="www" type="A" value={serverIp || "YOUR_SERVER_IP"} />
                            </>
                          ) : (
                            <DnsRecord name={subLabel || "@"} type="A" value={serverIp || "YOUR_SERVER_IP"} />
                          )}
                        </div>
                        <Button onClick={handleVerify} disabled={verifying} className="w-full h-9 text-xs" variant="outline">
                          {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-2" />}
                          Verify DNS
                        </Button>
                      </CardContent>
                    </Card>
                  )}

                  {/* SSL Setup */}
                  {selected.verified && !selected.ssl_enabled && (
                    <Card className="bg-background border-border shadow-none rounded-xl">
                      <CardHeader className="p-4 pb-3 border-b border-border/50">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Shield className="w-4 h-4 text-primary" />
                          Enable SSL (Let's Encrypt)
                        </CardTitle>
                        <CardDescription className="text-xs text-muted-foreground">
                          Free TLS certificate via certbot. DNS must already point to this server.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="p-4 space-y-3">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Email for Let's Encrypt notifications</Label>
                          <Input value={sslEmail} onChange={e => setSslEmail(e.target.value)} placeholder="admin@example.com" type="email" className="font-mono text-xs h-9" disabled={sslRunning} />
                        </div>
                        <Button onClick={handleSSL} disabled={sslRunning || !sslEmail.trim()} className="w-full h-9 text-xs border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none">
                          {sslRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <ShieldCheck className="w-3.5 h-3.5 mr-2" />}
                          {sslRunning ? "Running certbot..." : "Enable SSL"}
                        </Button>

                        {sslLogs.length > 0 && (
                          <div ref={logRef} className="bg-black/95 text-green-400 font-mono text-xs p-3 rounded-lg h-48 overflow-y-auto whitespace-pre-wrap">
                            {sslLogs.map((l, i) => (
                              <span key={i} className={l.stream === "stderr" ? "text-red-400" : l.stream === "system" ? "text-cyan-400" : "text-green-400"}>
                                {l.text}
                              </span>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* SSL active info */}
                  {selected.ssl_enabled && (
                    <Card className="bg-background border-border shadow-none rounded-xl">
                      <CardContent className="p-6 flex items-start gap-4">
                        <div className="p-2 bg-primary/10 rounded-full">
                          <ShieldCheck className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground mb-1">SSL Active</p>
                          <a href={`https://${selected.domain}`} target="_blank" rel="noreferrer" className="text-xs font-mono text-primary hover:underline">
                            https://{selected.domain}
                          </a>
                          <p className="text-xs text-muted-foreground mt-2">
                            Proxying to <span className="font-mono">127.0.0.1:{selected.target_port}</span>. Certificate auto-renews via certbot.
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function DnsRecord({ name, type, value }: { name: string; type: string; value: string }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-xs font-mono bg-muted/30 rounded px-3 py-2 border border-border/40">
      <div>
        <p className="text-muted-foreground text-[9px] uppercase tracking-wider mb-0.5">Name</p>
        <p className="text-foreground font-semibold">{name}</p>
      </div>
      <div>
        <p className="text-muted-foreground text-[9px] uppercase tracking-wider mb-0.5">Type</p>
        <p className="text-primary font-semibold">{type}</p>
      </div>
      <div>
        <p className="text-muted-foreground text-[9px] uppercase tracking-wider mb-0.5">Value</p>
        <p className="text-foreground truncate">{value}</p>
      </div>
    </div>
  );
}

function ProxyStatusBadge({ domain }: { domain: ProxyDomain }) {
  if (domain.ssl_enabled) {
    return (
      <Badge variant="outline" className="text-primary bg-primary/10 border-primary/20 font-mono text-[10px] rounded-full px-2 py-0 inline-flex items-center gap-1">
        <ShieldCheck className="w-2.5 h-2.5" />SSL
      </Badge>
    );
  }
  if (domain.verified) {
    return (
      <Badge variant="outline" className="text-emerald-500 bg-emerald-500/10 border-emerald-500/30 font-mono text-[10px] rounded-full px-2 py-0 inline-flex items-center gap-1">
        <CheckCircle2 className="w-2.5 h-2.5" />Verified
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-amber-500 bg-amber-500/10 border-amber-500/30 font-mono text-[10px] rounded-full px-2 py-0 inline-flex items-center gap-1">
      <Clock className="w-2.5 h-2.5" />Pending DNS
    </Badge>
  );
}
