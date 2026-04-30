"use client"

import * as React from "react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@/components/ui/chart"

export const description = "An interactive line chart with 4 metrics"

const chartData = [
    { date: "2024-04-01", queries: 222, size: 150, tables: 12, rows: 450 },
    { date: "2024-04-02", queries: 97, size: 180, tables: 12, rows: 480 },
    { date: "2024-04-03", queries: 167, size: 120, tables: 14, rows: 420 },
    { date: "2024-04-04", queries: 242, size: 260, tables: 14, rows: 560 },
    { date: "2024-04-05", queries: 373, size: 290, tables: 14, rows: 590 },
    { date: "2024-04-06", queries: 301, size: 340, tables: 16, rows: 640 },
    { date: "2024-04-07", queries: 245, size: 180, tables: 16, rows: 480 },
    { date: "2024-04-08", queries: 409, size: 320, tables: 16, rows: 620 },
    { date: "2024-04-09", queries: 59, size: 110, tables: 10, rows: 310 },
    { date: "2024-04-10", queries: 261, size: 190, tables: 12, rows: 490 },
    { date: "2024-05-01", queries: 365, size: 420, tables: 18, rows: 720 },
    { date: "2024-05-15", queries: 473, size: 380, tables: 20, rows: 680 },
    { date: "2024-06-01", queries: 178, size: 200, tables: 22, rows: 500 },
    { date: "2024-06-15", queries: 307, size: 350, tables: 24, rows: 650 },
    { date: "2024-06-30", queries: 446, size: 400, tables: 24, rows: 700 },
]

const chartConfig = {
    queries: {
        label: "Queries",
        color: "#2563eb",
    },
    size: {
        label: "Size (MB)",
        color: "#60a5fa",
    },
    tables: {
        label: "Tables",
        color: "#f59e0b",
    },
    rows: {
        label: "Rows (k)",
        color: "#8b5cf6",
    },
} satisfies ChartConfig

export function ChartLineInteractive() {
    const [activeMetrics, setActiveMetrics] = React.useState<string[]>([
        "queries",
        "size",
        "tables",
        "rows",
    ])

    const total = React.useMemo(
        () => ({
            queries: chartData.reduce((acc, curr) => acc + curr.queries, 0),
            size: chartData.reduce((acc, curr) => acc + curr.size, 0),
            tables: chartData.reduce((acc, curr) => acc + curr.tables, 0),
            rows: chartData.reduce((acc, curr) => acc + curr.rows, 0),
        }),
        []
    )

    const toggleMetric = (metric: string) => {
        setActiveMetrics((prev) =>
            prev.includes(metric)
                ? prev.filter((m) => m !== metric)
                : [...prev, metric]
        )
    }

    return (
        <Card className="py-4 sm:py-0 rounded-2xl border border-[#1c1c1c1a] dark:border-[#ffffff12] shadow-none bg-white dark:bg-[#161d2b]">
            <CardHeader className="flex flex-col items-stretch border-b border-[#1c1c1c0a] dark:border-[#ffffff0a] !p-0 sm:flex-row">
                <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-4 sm:py-0">
                    <CardTitle className="text-sm font-semibold text-[#1c1c1c] dark:text-[#e2e8f0]">Total Query Line</CardTitle>
                    <CardDescription className="text-xs text-[#1c1c1c66] dark:text-[#64748b]">
                        Multi-metric performance history
                    </CardDescription>
                </div>
                <div className="flex border-t sm:border-t-0 border-[#1c1c1c0a] dark:border-[#ffffff0a]">
                    {Object.keys(chartConfig).map((key) => {
                        const chart = key as keyof typeof chartConfig
                        const isActive = activeMetrics.includes(key)
                        return (
                            <button
                                key={chart}
                                data-active={isActive}
                                className="flex flex-1 flex-col justify-center gap-1 border-r last:border-r-0 border-[#1c1c1c0a] dark:border-[#ffffff0a] px-4 py-3 text-left data-[active=true]:bg-[#1c1c1c05] dark:data-[active=true]:bg-[#ffffff05] transition-colors"
                                onClick={() => toggleMetric(key)}
                            >
                                <span className="text-[10px] uppercase font-bold tracking-wider text-[#1c1c1c66] dark:text-[#64748b] whitespace-nowrap">
                                    {chartConfig[chart].label}
                                </span>
                                <span className="text-base leading-none font-medium text-[#1c1c1c] dark:text-[#e2e8f0] whitespace-nowrap">
                                    {total[key as keyof typeof total].toLocaleString()}
                                </span>
                            </button>
                        )
                    })}
                </div>
            </CardHeader>
            <CardContent className="px-2 sm:p-6">
                <ChartContainer
                    config={chartConfig}
                    className="aspect-auto h-[300px] w-full"
                >
                    <LineChart
                        accessibilityLayer
                        data={chartData}
                        margin={{
                            left: 12,
                            right: 12,
                            top: 20,
                        }}
                    >
                        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#88888822" />
                        <XAxis
                            dataKey="date"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={12}
                            minTickGap={32}
                            tick={{ fontSize: 10, fill: "currentColor", opacity: 0.5 }}
                            tickFormatter={(value) => {
                                const date = new Date(value)
                                return date.toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                })
                            }}
                        />
                        <ChartTooltip
                            content={
                                <ChartTooltipContent
                                    className="w-[180px] rounded-xl border-[#1c1c1c12] dark:border-[#ffffff12] bg-white dark:bg-[#161d2b] shadow-xl"
                                    labelFormatter={(value) => {
                                        return new Date(value).toLocaleDateString("en-US", {
                                            month: "short",
                                            day: "numeric",
                                            year: "numeric",
                                        })
                                    }}
                                />
                            }
                        />
                        {Object.keys(chartConfig).map((key) => {
                            if (!activeMetrics.includes(key)) return null;
                            return (
                                <Line
                                    key={key}
                                    dataKey={key}
                                    type="monotone"
                                    stroke={chartConfig[key as keyof typeof chartConfig].color}
                                    strokeWidth={2.5}
                                    dot={false}
                                    activeDot={{ r: 4, strokeWidth: 0 }}
                                    animationDuration={1000}
                                />
                            );
                        })}
                    </LineChart>
                </ChartContainer>
            </CardContent>
        </Card>
    )
}
