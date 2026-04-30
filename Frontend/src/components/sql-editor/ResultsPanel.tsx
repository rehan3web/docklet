import React from "react";
import {
    Panel,
    PanelGroup,
    PanelResizeHandle
} from "react-resizable-panels";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Terminal, Table as TableIcon, Info, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ResultsPanelProps {
    children: React.ReactNode;
    results: any[] | null;
    logs: string[];
    executionTime?: string;
    rowCount?: number;
    error?: string | null;
}

export function ResultsPanel({ children, results, logs, executionTime, rowCount, error }: ResultsPanelProps) {
    return (
        <PanelGroup direction="vertical" className="h-full">
            <Panel defaultSize={60} minSize={30}>
                <div className="h-full">
                    {children}
                </div>
            </Panel>

            <PanelResizeHandle className="h-1.5 w-full bg-border/20 hover:bg-primary/40 transition-colors flex items-center justify-center group">
                <div className="w-8 h-1 rounded-full bg-muted-foreground/20 group-hover:bg-primary/60 transition-colors" />
            </PanelResizeHandle>

            <Panel defaultSize={40} minSize={20}>
                <div className="h-full border-t border-border bg-background overflow-hidden flex flex-col">
                    <Tabs defaultValue="results" className="flex flex-col h-full">
                        <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between shrink-0">
                            <TabsList className="h-8 bg-transparent p-0 gap-4">
                                <TabsTrigger
                                    value="results"
                                    className={cn(
                                        "relative h-8 px-1 bg-transparent border-none text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none font-medium text-xs rounded-none transition-none",
                                        "after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:opacity-0 data-[state=active]:after:opacity-100"
                                    )}
                                >
                                    <TableIcon className="w-3.5 h-3.5 mr-2" />
                                    Results
                                </TabsTrigger>
                                <TabsTrigger
                                    value="console"
                                    className={cn(
                                        "relative h-8 px-1 bg-transparent border-none text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none font-medium text-xs rounded-none transition-none",
                                        "after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:opacity-0 data-[state=active]:after:opacity-100"
                                    )}
                                >
                                    <Terminal className="w-3.5 h-3.5 mr-2" />
                                    Console
                                </TabsTrigger>
                            </TabsList>

                            <div className="flex items-center gap-3">
                                {rowCount !== undefined && (
                                    <Badge variant="outline" className="h-5 px-2 font-mono text-[10px] bg-muted/50 border-border text-muted-foreground">
                                        {rowCount} rows
                                    </Badge>
                                )}
                                {executionTime && (
                                    <span className="text-[10px] text-muted-foreground font-mono">
                                        {executionTime}
                                    </span>
                                )}
                            </div>
                        </div>

                        <TabsContent value="results" className="flex-1 m-0 overflow-hidden relative">
                            <ScrollArea className="h-full w-full">
                                <div className="min-w-full inline-block align-middle">
                                    <div className="border-none rounded-none overflow-hidden">
                                        <Table className="border-collapse">
                                            <TableHeader className="bg-muted/30 hover:bg-muted/30 sticky top-0 z-10">
                                                <TableRow className="border-border hover:bg-transparent">
                                                    {results && results.length > 0 ? (
                                                        Object.keys(results[0]).map((key) => (
                                                            <TableHead key={key} className="h-9 font-mono text-[11px] font-semibold text-foreground border-r border-border px-4 py-0 uppercase tracking-tight last:border-r-0">
                                                                {key}
                                                            </TableHead>
                                                        ))
                                                    ) : (
                                                        <TableHead className="h-0 p-0" />
                                                    )}
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {results && results.length > 0 ? (
                                                    results.map((row, i) => (
                                                        <TableRow key={i} className="border-border hover:bg-muted/20 transition-colors group">
                                                            {Object.values(row).map((val: any, j) => (
                                                                <TableCell key={j} className="h-9 font-mono text-xs text-muted-foreground border-r border-border px-4 py-0 last:border-r-0 group-hover:text-foreground transition-colors truncate max-w-[200px]">
                                                                    {String(val)}
                                                                </TableCell>
                                                            ))}
                                                        </TableRow>
                                                    ))
                                                ) : (
                                                    <TableRow className="border-none hover:bg-transparent">
                                                        <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                                                            {error ? (
                                                                <div className="flex flex-col items-center gap-2">
                                                                    <AlertCircle className="w-5 h-5 text-destructive opacity-70" />
                                                                    <span className="text-sm text-destructive">{error}</span>
                                                                </div>
                                                            ) : (
                                                                <div className="flex flex-col items-center gap-2">
                                                                    <Info className="w-5 h-5 opacity-20" />
                                                                    <span className="text-sm">Run a query to see results</span>
                                                                </div>
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                                <ScrollBar orientation="horizontal" />
                                <ScrollBar orientation="vertical" />
                            </ScrollArea>
                        </TabsContent>

                        <TabsContent value="console" className="flex-1 m-0 bg-muted/5 p-4 font-mono text-xs overflow-auto">
                            {(logs ?? []).length > 0 ? (
                                <div className="space-y-2">
                                    {(logs ?? []).map((log, i) => (
                                        <div key={i} className={cn(
                                            "flex items-start gap-2 p-2 rounded-md border",
                                            log.toLowerCase().includes("error")
                                                ? "bg-destructive/5 border-destructive/20 text-destructive"
                                                : "bg-muted/30 border-border text-muted-foreground"
                                        )}>
                                            {log.toLowerCase().includes("error") ? (
                                                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                            ) : (
                                                <Terminal className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-50" />
                                            )}
                                            <span>{log}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-muted-foreground/40 italic">
                                    No logs reported
                                </div>
                            )}
                        </TabsContent>
                    </Tabs>
                </div>
            </Panel>
        </PanelGroup>
    );
}
