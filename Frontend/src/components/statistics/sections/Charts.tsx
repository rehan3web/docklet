import * as React from "react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@/components/ui/chart"

interface ThroughputBucket {
    timestamp: number
    queries: number
    inserts: number
    updates: number
    deletes: number
}

interface ChartLineInteractiveProps {
    throughput?: ThroughputBucket[]
    loading?: boolean
}

const chartConfig = {
    queries: { label: "Queries/s", color: "hsl(var(--primary))" },
    inserts: { label: "Inserts/s", color: "hsl(var(--chart-2))" },
    updates: { label: "Updates/s", color: "hsl(var(--chart-3))" },
    deletes: { label: "Deletes/s", color: "hsl(var(--chart-4))" },
} satisfies ChartConfig

const METRICS = Object.keys(chartConfig) as Array<keyof typeof chartConfig>

function formatTime(ts: number) {
    return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

export function ChartLineInteractive({ throughput = [], loading = false }: ChartLineInteractiveProps) {
    const [activeMetrics, setActiveMetrics] = React.useState<string[]>([...METRICS])

    const chartData = React.useMemo(() =>
        throughput.map(b => ({
            time: formatTime(b.timestamp),
            queries: b.queries,
            inserts: b.inserts,
            updates: b.updates,
            deletes: b.deletes,
        })),
        [throughput]
    )

    const total = React.useMemo(() => ({
        queries: throughput.reduce((acc, b) => acc + b.queries, 0),
        inserts: throughput.reduce((acc, b) => acc + b.inserts, 0),
        updates: throughput.reduce((acc, b) => acc + b.updates, 0),
        deletes: throughput.reduce((acc, b) => acc + b.deletes, 0),
    }), [throughput])

    const toggle = (metric: string) =>
        setActiveMetrics(prev =>
            prev.includes(metric) ? prev.filter(m => m !== metric) : [...prev, metric]
        )

    if (loading) {
        return (
            <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-b border-border pb-4">
                    {METRICS.map((key) => (
                        <div key={key} className="flex flex-col gap-0.5 p-3 sm:p-5 rounded-lg border border-border bg-muted/10 animate-pulse">
                            <span className="h-3 w-16 bg-muted rounded" />
                            <span className="h-7 w-10 bg-muted rounded mt-1" />
                        </div>
                    ))}
                </div>
                <div className="h-[280px] w-full bg-muted/10 rounded animate-pulse" />
            </div>
        )
    }

    if (chartData.length === 0) {
        return (
            <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-b border-border pb-4">
                    {METRICS.map((key) => (
                        <button
                            key={key}
                            onClick={() => toggle(key)}
                            className={`flex flex-col gap-0.5 p-3 sm:p-5 rounded-lg border text-left transition-all w-full min-w-0 overflow-hidden ${
                                activeMetrics.includes(key)
                                    ? "bg-muted border-border"
                                    : "bg-transparent border-transparent opacity-40"
                            }`}
                        >
                            <span className="text-xs font-medium text-muted-foreground tracking-wide truncate">
                                {chartConfig[key].label}
                            </span>
                            <span className="text-xl sm:text-2xl font-normal tracking-tight text-foreground truncate">
                                0
                            </span>
                        </button>
                    ))}
                </div>
                <div className="h-[280px] w-full flex items-center justify-center text-muted-foreground/40 text-sm italic">
                    No activity recorded yet — run queries to populate the timeline.
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-b border-border pb-4">
                {METRICS.map((key) => {
                    const isActive = activeMetrics.includes(key)
                    return (
                        <button
                            key={key}
                            onClick={() => toggle(key)}
                            className={`flex flex-col gap-0.5 p-3 sm:p-5 rounded-lg border text-left transition-all w-full min-w-0 overflow-hidden ${
                                isActive
                                    ? "bg-muted border-border"
                                    : "bg-transparent border-transparent opacity-40"
                            }`}
                        >
                            <span className="text-xs font-medium text-muted-foreground tracking-wide truncate">
                                {chartConfig[key].label}
                            </span>
                            <span className="text-xl sm:text-2xl font-normal tracking-tight text-foreground truncate">
                                {total[key].toLocaleString()}
                            </span>
                        </button>
                    )
                })}
            </div>

            <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
                <LineChart
                    accessibilityLayer
                    data={chartData}
                    margin={{ left: 4, right: 4, top: 16 }}
                >
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                        dataKey="time"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={10}
                        minTickGap={48}
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    />
                    <ChartTooltip
                        content={
                            <ChartTooltipContent
                                className="w-[180px] rounded-lg border-border bg-popover shadow-md"
                                labelFormatter={(value) => `Time: ${value}`}
                            />
                        }
                    />
                    {METRICS.map((key) =>
                        activeMetrics.includes(key) ? (
                            <Line
                                key={key}
                                dataKey={key}
                                type="monotone"
                                stroke={chartConfig[key].color}
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 4, strokeWidth: 0 }}
                                isAnimationActive={false}
                            />
                        ) : null
                    )}
                </LineChart>
            </ChartContainer>
        </div>
    )
}
