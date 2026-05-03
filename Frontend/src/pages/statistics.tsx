import React from "react";
import { Activity, Database, LayoutList, Server, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DesktopSidebar, MobileSidebarTrigger, IconStatistics } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { ChartLineInteractive } from "@/components/statistics/sections/Charts";
import { useGetDbStats } from "@/api/client";

function MetricCard({ title, value, icon, loading }: { title: string; value: string; icon: React.ReactNode; loading?: boolean }) {
    return (
        <Card className="bg-background border-border shadow-none rounded-lg overflow-hidden relative group">
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                    <p className="text-xs font-medium text-muted-foreground tracking-wide">{title}</p>
                    {icon}
                </div>
                {loading ? <Skeleton className="h-8 w-24 bg-muted" /> : <p className="text-2xl font-normal tracking-tight text-foreground">{value}</p>}
            </CardContent>
        </Card>
    );
}

export default function StatisticsPage() {
    const { theme, toggle } = useTheme();
    const { data: stats, isLoading } = useGetDbStats();

    const totalRows = stats?.totalRows ?? 0;
    const rowsFormatted = totalRows >= 1_000_000
        ? `${(totalRows / 1_000_000).toFixed(2)}M`
        : totalRows >= 1_000
        ? `${(totalRows / 1_000).toFixed(1)}K`
        : String(totalRows);

    const totalQueries = stats?.throughput
        ? stats.throughput.reduce((sum: number, b: any) => sum + (b.queries || 0), 0)
        : 0;
    const queriesFormatted = totalQueries >= 1000 ? `${(totalQueries / 1000).toFixed(1)}K` : String(totalQueries);

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
                                    <IconStatistics className="w-4 h-4 text-primary" />
                                </div>
                                <span className="font-medium text-sm tracking-tight text-foreground">Statistics & Analytics</span>
                            </div>
                        </div>
                        <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" onClick={toggle} aria-label="Toggle theme">
                            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                        </Button>
                    </div>
                </header>
                <main className="flex-1 px-4 py-8 space-y-8 pb-24 max-w-6xl w-full mx-auto">
                    <div className="flex flex-col gap-2 mb-10">
                        <h1 className="text-4xl sm:text-5xl font-normal tracking-tight text-foreground leading-none">Statistics & Analytics</h1>
                        <p className="text-muted-foreground text-sm max-w-xl leading-relaxed">Node-level performance metrics and query distribution over time.</p>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <MetricCard title="Session Queries" value={queriesFormatted} icon={<Activity className="w-4 h-4 text-muted-foreground" />} loading={isLoading} />
                        <MetricCard title="Database Size" value={stats?.dbSize ?? "—"} icon={<Database className="w-4 h-4 text-muted-foreground" />} loading={isLoading} />
                        <MetricCard title="Total Tables" value={String(stats?.totalTables ?? "—")} icon={<LayoutList className="w-4 h-4 text-muted-foreground" />} loading={isLoading} />
                        <MetricCard title="Total Rows" value={rowsFormatted} icon={<Server className="w-4 h-4 text-muted-foreground" />} loading={isLoading} />
                    </div>
                    <Card className="bg-background border-border shadow-none rounded-xl overflow-hidden">
                        <CardHeader className="p-6 pb-2">
                            <CardTitle className="text-base font-medium tracking-tight">Query Throughput Timeline</CardTitle>
                            <CardDescription className="text-xs text-muted-foreground">Live queries, inserts, updates, and deletes per second over time</CardDescription>
                        </CardHeader>
                        <CardContent className="p-6">
                            <ChartLineInteractive throughput={stats?.throughput ?? []} loading={isLoading} />
                        </CardContent>
                    </Card>
                </main>
            </div>
        </div>
    );
}
