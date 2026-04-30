import { useState, useCallback, useEffect } from "react";
import {
    ReactFlow, Background, Controls, Edge, Node,
    useNodesState, useEdgesState,
    Handle, Position, ReactFlowProvider, useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Key, Link as LinkIcon, Search, Sun, Moon, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DesktopSidebar, MobileSidebarTrigger, IconVisualizer } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { useGetSchema } from "@/api/client";

const Table2Icon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
    </svg>
);

const TableNode = ({ data }: { data: any }) => (
    <Card className={`min-w-[220px] border-border bg-card text-card-foreground shadow-xl cursor-grab active:cursor-grabbing overflow-hidden rounded-xl border-2 transition-all duration-300 ${data.isHighlighted ? "ring-4 ring-primary ring-offset-2 scale-105 z-50" : ""}`}>
        <div className={`px-4 py-2.5 font-bold flex items-center gap-2 transition-colors ${data.isHighlighted ? "bg-primary text-primary-foreground" : "bg-muted text-foreground border-b border-border"}`}>
            <Table2Icon />
            <span className="text-sm tracking-tight">{data.tableName}</span>
        </div>
        <div className="p-1 space-y-0.5 bg-card">
            {data.columns.map((col: any, idx: number) => (
                <div key={idx} className="relative flex justify-between items-center text-[11px] py-1.5 px-3 hover:bg-muted rounded-lg transition-colors group">
                    <Handle type="target" position={Position.Left} id={`${col.name}-target`} className="!w-2 !h-2 !bg-primary/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="flex items-center gap-2 overflow-hidden">
                        {col.isPk ? <Key className="w-3 h-3 text-amber-500 shrink-0" /> : col.isFk ? <LinkIcon className="w-3 h-3 text-blue-500 shrink-0" /> : <div className="w-3 h-3 shrink-0" />}
                        <span className={`font-medium truncate ${col.isPk ? "text-amber-500" : col.isFk ? "text-blue-500" : "text-foreground/80"}`}>{col.name}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground/60 font-mono ml-4">{col.type}</span>
                    <Handle type="source" position={Position.Right} id={`${col.name}-source`} className="!w-2 !h-2 !bg-primary/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
            ))}
        </div>
    </Card>
);

const nodeTypes = { tableNode: TableNode };

function buildGraph(tables: any[], relations: any[]) {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const cols = 3;
    const xGap = 300;
    const yGap = 380;

    tables.forEach((table: any, i: number) => {
        nodes.push({
            id: table.name,
            type: "tableNode",
            position: { x: (i % cols) * xGap + 60, y: Math.floor(i / cols) * yGap + 60 },
            data: { tableName: table.name, columns: table.columns, isHighlighted: false },
        });
    });

    relations.forEach((rel: any) => {
        edges.push({
            id: `${rel.from}-${rel.fromCol}->${rel.to}-${rel.toCol}`,
            source: rel.from,
            target: rel.to,
            type: "smoothstep",
            animated: true,
            style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
            label: `${rel.fromCol} → ${rel.toCol}`,
            labelStyle: { fill: "hsl(var(--primary))", fontWeight: 600, fontSize: 10 },
            labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.9 },
            labelBgPadding: [4, 2] as [number, number],
            labelBgBorderRadius: 4,
            markerEnd: { type: "arrowclosed" as any, color: "hsl(var(--primary))" },
        });
    });

    return { nodes, edges };
}

function VisualizerCanvas({ tables, relations }: { tables: any[]; relations: any[] }) {
    const { nodes: initNodes, edges: initEdges } = buildGraph(tables, relations);
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initEdges);
    const [searchQuery, setSearchQuery] = useState("");
    const { fitView } = useReactFlow();

    useEffect(() => {
        const { nodes: n, edges: e } = buildGraph(tables, relations);
        setNodes(n);
        setEdges(e);
        // eslint-disable-next-line
    }, [tables, relations]);

    const handleSearch = useCallback((query: string) => {
        setSearchQuery(query);
        setNodes(prev => prev.map(node => ({
            ...node,
            data: { ...node.data, isHighlighted: !!query && node.id.toLowerCase().includes(query.toLowerCase()) },
        })));
        if (query) {
            const match = nodes.find(n => n.id.toLowerCase().includes(query.toLowerCase()));
            if (match) fitView({ nodes: [match], duration: 800, padding: 0.5 });
        }
    }, [nodes, setNodes, fitView]);

    return (
        <div className="h-full w-full relative">
            <div className="absolute top-4 left-4 z-10 flex flex-col gap-3">
                <div className="flex items-center gap-2 bg-background/90 backdrop-blur border border-border px-3 py-1.5 rounded-lg shadow-sm w-60">
                    <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <Input placeholder="Search tables..." className="h-7 border-none bg-transparent focus-visible:ring-0 text-xs p-0 shadow-none" value={searchQuery} onChange={e => handleSearch(e.target.value)} />
                </div>
                <div className="flex gap-4 bg-background/90 backdrop-blur border border-border px-4 py-2.5 rounded-lg shadow-sm">
                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-500" /><span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">PK</span></div>
                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-blue-500" /><span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">FK</span></div>
                    <div className="flex items-center gap-1.5"><div className="w-5 h-[2px] bg-primary rounded-full" /><span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Relation</span></div>
                </div>
                <div className="bg-background/90 backdrop-blur border border-border px-3 py-2 rounded-lg shadow-sm">
                    <span className="text-[11px] text-muted-foreground font-mono">{tables.length} table{tables.length !== 1 ? "s" : ""} · {relations.length} relation{relations.length !== 1 ? "s" : ""}</span>
                </div>
            </div>
            <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} fitView className="bg-background">
                <Background color="hsl(var(--border))" gap={20} />
                <Controls className="bg-background border-border" />
            </ReactFlow>
        </div>
    );
}

export default function VisualizerPage() {
    const { theme, toggle } = useTheme();
    const { data: schema, isLoading, refetch } = useGetSchema();

    return (
        <div className="min-h-screen bg-background text-foreground flex">
            <DesktopSidebar />
            <div className="flex-1 flex flex-col min-w-0 h-screen">
                <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border shrink-0">
                    <div className="px-4 h-18 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <MobileSidebarTrigger />
                            <div className="hidden lg:flex items-center gap-3">
                                <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0">
                                    <IconVisualizer className="w-4 h-4 text-primary" />
                                </div>
                                <span className="font-medium text-sm tracking-tight text-foreground">Schema Visualizer</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" className="h-8 rounded-full border-border hover:bg-muted font-medium text-xs text-foreground bg-transparent" onClick={() => refetch()}>
                                <RefreshCw className="w-3.5 h-3.5 mr-2" />Refresh
                            </Button>
                            <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" onClick={toggle} aria-label="Toggle theme">
                                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                            </Button>
                        </div>
                    </div>
                </header>
                <div className="flex-1 overflow-hidden">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="flex flex-col items-center gap-3">
                                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                <p className="text-sm text-muted-foreground">Loading schema...</p>
                            </div>
                        </div>
                    ) : !schema || schema.tables.length === 0 ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                                <p className="text-muted-foreground text-sm">No tables found in the database.</p>
                                <p className="text-muted-foreground text-xs mt-1">Create some tables first in the Table Editor.</p>
                            </div>
                        </div>
                    ) : (
                        <ReactFlowProvider>
                            <VisualizerCanvas tables={schema.tables} relations={schema.relations} />
                        </ReactFlowProvider>
                    )}
                </div>
            </div>
        </div>
    );
}
