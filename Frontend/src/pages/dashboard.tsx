import React, { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { RefreshCw, Database, Activity, LayoutList, Server, Sun, Moon, Plug } from "lucide-react";
import { ConnectPanel } from "@/components/ConnectPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { DesktopSidebar, MobileSidebarTrigger, IconDashboard } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import {
  useHealthCheck,
  useGetDbOverview,
  useGetDbTables,
  useGetDbThroughput,
  useGetDbActivity,
  getGetDbOverviewQueryKey,
  getGetDbTablesQueryKey,
  getGetDbThroughputQueryKey,
  getGetDbActivityQueryKey,
  useGetTableDetails,
} from "@/api/mock";

function formatChartTime(value: unknown) {
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return format(date, "HH:mm:ss");
    }
    return value;
  }

  if (typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return format(date, "HH:mm:ss");
    }
  }

  return "";
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { theme, toggle } = useTheme();
  const [connectOpen, setConnectOpen] = useState(false);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetDbOverviewQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDbTablesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDbThroughputQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDbActivityQueryKey() });
  }, [queryClient]);

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <ConnectPanel isOpen={connectOpen} onClose={() => setConnectOpen(false)} />
      {/* Desktop Sidebar */}
      <DesktopSidebar />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="px-4 h-18 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Mobile sidebar trigger */}
              <MobileSidebarTrigger />

              {/* Page title on mobile */}
              <div className="flex items-center gap-2 lg:hidden">
                <span className="font-semibold text-sm tracking-tight text-foreground">Database Metrics</span>
              </div>

              {/* Desktop title — hidden on mobile */}
              <div className="hidden lg:flex items-center gap-3">
                <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0">
                  <IconDashboard className="w-4 h-4 text-primary" />
                </div>
                <span className="font-medium text-sm tracking-tight text-foreground">Database Metrics</span>
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 px-3 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none"
                  onClick={() => setConnectOpen(true)}
                >
                  <Plug className="w-3 h-3" />
                  Connect
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Theme toggle */}
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                onClick={toggle}
                aria-label="Toggle theme"
              >
                {theme === "dark" ? (
                  <Sun className="w-4 h-4" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-full border-border hover:bg-muted font-medium text-xs text-foreground bg-transparent"
                onClick={handleRefresh}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-2" />
                Refresh
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-8 space-y-8 pb-24 max-w-6xl w-full mx-auto">
          {/* Title Section */}
          <div className="flex flex-col gap-2 mb-10">
            <h1 className="text-4xl sm:text-5xl font-normal tracking-tight text-foreground leading-none">Database Metrics</h1>
            <p className="text-muted-foreground text-sm max-w-xl leading-relaxed">
              Real-time infrastructure health, throughput analysis, and active queries.
            </p>
          </div>

          <OverviewSection />

          <div className="space-y-6">
            <ThroughputSection />
            <TablesSection />
            <ActivitySection />
          </div>
        </main>
      </div>
    </div>
  );
}

function OverviewSection() {
  const { data: overview, isLoading: overviewLoading } = useGetDbOverview();
  const { data: health } = useHealthCheck();

  if (overviewLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="bg-background border-border shadow-none rounded-lg">
            <CardContent className="p-5">
              <Skeleton className="h-4 w-1/2 mb-2 bg-muted" />
              <Skeleton className="h-8 w-3/4 bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <MetricCard 
        title="Database Health" 
        value={health?.status === "ok" ? "Healthy" : "Degraded"} 
        valueColor={health?.status === "ok" ? "text-primary" : "text-destructive"}
        icon={<Activity className="w-4 h-4 text-muted-foreground" />}
      />
      <MetricCard 
        title="Active Connections" 
        value={overview?.activeConnections?.toString() || "0"} 
        icon={<Server className="w-4 h-4 text-muted-foreground" />}
      />
      <MetricCard 
        title="Total Database Size" 
        value={overview?.databaseSize || "0 MB"} 
        icon={<Database className="w-4 h-4 text-muted-foreground" />}
      />
      <MetricCard 
        title="Total Tables" 
        value={overview?.tableCount?.toString() || "0"} 
        icon={<LayoutList className="w-4 h-4 text-muted-foreground" />}
      />
    </div>
  );
}

function MetricCard({ title, value, icon, valueColor = "text-foreground" }: { title: string, value: string, icon: React.ReactNode, valueColor?: string }) {
  return (
    <Card className="bg-background border-border shadow-none rounded-lg overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-medium text-muted-foreground tracking-wide">{title}</p>
          {icon}
        </div>
        <p className={`text-2xl font-normal tracking-tight ${valueColor}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function ThroughputSection() {
  const { data, isLoading } = useGetDbThroughput();

  return (
    <Card className="bg-background border-border shadow-none rounded-xl overflow-hidden">
      <CardHeader className="p-6 pb-2">
        <CardTitle className="text-base font-medium tracking-tight">Throughput</CardTitle>
        <CardDescription className="text-xs text-muted-foreground">Operations per second</CardDescription>
      </CardHeader>
      <CardContent className="p-6">
        <div className="h-[280px] w-full">
          {isLoading ? (
            <Skeleton className="w-full h-full bg-muted" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.dataPoints || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis 
                  dataKey="timestamp" 
                  tickFormatter={formatChartTime}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', borderRadius: '6px', fontSize: '12px' }}
                  itemStyle={{ color: 'hsl(var(--foreground))' }}
                  labelStyle={{ color: 'hsl(var(--muted-foreground))', marginBottom: '4px' }}
                  labelFormatter={formatChartTime}
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                <Line type="monotone" dataKey="queries" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Queries" isAnimationActive={false} />
                <Line type="monotone" dataKey="inserts" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} name="Inserts" isAnimationActive={false} />
                <Line type="monotone" dataKey="updates" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} name="Updates" isAnimationActive={false} />
                <Line type="monotone" dataKey="deletes" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} name="Deletes" isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ActivitySection() {
  const { data, isLoading } = useGetDbActivity();

  return (
    <Card className="bg-background border-border shadow-none rounded-xl overflow-hidden">
      <CardHeader className="p-6 pb-4 border-b border-border/50">
        <CardTitle className="text-base font-medium tracking-tight">Recent Activity</CardTitle>
      </CardHeader>
      <div className="overflow-hidden">
        <Table className="table-fixed w-full">
          <colgroup>
            <col className="w-1/4" />
            <col className="w-1/4" />
            <col className="w-1/4" />
            <col className="w-1/4" />
          </colgroup>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-xs font-medium text-muted-foreground px-6">STARTED</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground px-6">STATE</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground px-6">DURATION</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground px-6">QUERY</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i} className="border-border">
                  <TableCell className="px-6"><Skeleton className="h-4 w-20 bg-muted" /></TableCell>
                  <TableCell className="px-6"><Skeleton className="h-4 w-12 bg-muted" /></TableCell>
                  <TableCell className="px-6"><Skeleton className="h-4 w-12 bg-muted" /></TableCell>
                  <TableCell className="px-6"><Skeleton className="h-4 w-full bg-muted" /></TableCell>
                </TableRow>
              ))
            ) : data?.activities?.length === 0 ? (
              <TableRow className="border-border hover:bg-transparent">
                <TableCell colSpan={4} className="text-center text-muted-foreground text-sm py-8 px-6">
                  No recent activity found
                </TableCell>
              </TableRow>
            ) : (
              data?.activities?.slice(0, 8).map((activity, idx) => (
                <TableRow key={idx} className="border-border hover:bg-muted/30 transition-colors group">
                  <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap px-6">
                    {format(new Date(activity.startedAt), "HH:mm:ss.SSS")}
                  </TableCell>
                  <TableCell className="px-6">
                    <Badge variant="outline" className={`font-mono text-[10px] uppercase rounded-full px-2 py-0 border-border ${activity.state === 'active' ? 'text-primary bg-primary/10 border-primary/20' : 'text-muted-foreground bg-muted/50'}`}>
                      {activity.state}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-foreground px-6">
                    {activity.duration}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground truncate group-hover:text-foreground transition-colors px-6">
                    {activity.query}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function TablesSection() {
  const { data, isLoading } = useGetDbTables();

  return (
    <Card className="bg-background border-border shadow-none rounded-xl overflow-hidden">
      <CardHeader className="p-6 pb-4 border-b border-border/50">
        <CardTitle className="text-base font-medium tracking-tight">Tables</CardTitle>
      </CardHeader>
      <div className="overflow-hidden">
        <Table className="table-fixed w-full">
          <colgroup>
            <col className="w-1/3" />
            <col className="w-1/3" />
            <col className="w-1/3" />
          </colgroup>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-xs font-medium text-muted-foreground px-6">NAME</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground text-right px-6">ROWS</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground text-right px-6">SIZE</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i} className="border-border">
                  <TableCell className="px-6"><Skeleton className="h-4 w-24 bg-muted" /></TableCell>
                  <TableCell className="text-right px-6"><Skeleton className="h-4 w-12 bg-muted ml-auto" /></TableCell>
                  <TableCell className="text-right px-6"><Skeleton className="h-4 w-12 bg-muted ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : data?.tables?.length === 0 ? (
              <TableRow className="border-border hover:bg-transparent">
                <TableCell colSpan={3} className="text-center text-muted-foreground text-sm py-8 px-6">
                  No tables found
                </TableCell>
              </TableRow>
            ) : (
              data?.tables?.map((table) => (
                <TableRow key={table.tableName} className="border-border hover:bg-muted/30 transition-colors cursor-pointer group">
                  <TableCell className="font-medium text-sm text-foreground px-6">
                    {table.tableName}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground text-right px-6">
                    {table.rowCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground text-right group-hover:text-foreground transition-colors px-6">
                    {table.totalSize}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
