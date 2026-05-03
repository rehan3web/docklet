import React, { useState, useCallback } from "react";
import { DesktopSidebar, MobileSidebarTrigger, IconSQLEditor } from "@/components/AppSidebar";
import { SqlCodeEditor } from "@/components/sql-editor/SqlCodeEditor";
import { ResultsPanel } from "@/components/sql-editor/ResultsPanel";
import { Sun, Moon, Plus, X, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { runSqlQuery } from "@/api/client";

interface Tab {
    id: string;
    name: string;
    code: string;
    results: any[] | null;
    fields: any[];
    logs: string[];
    executionTime: string;
    rowCount?: number;
    error?: string | null;
}

const STORAGE_KEY = "nextbase_sql_tabs";
const ACTIVE_TAB_KEY = "nextbase_sql_active_tab";

function loadTabsFromStorage(): Tab[] {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed.map(t => ({ ...t, results: null, fields: [], logs: [], executionTime: "", error: null }));
            }
        }
    } catch {}
    return [{ id: "1", name: "Query 1", code: "SELECT * FROM information_schema.tables WHERE table_schema = 'public' LIMIT 20;", results: null, fields: [], logs: [], executionTime: "", error: null }];
}

export default function SqlEditorPage() {
    const { theme, toggle } = useTheme();
    const [tabs, setTabs] = useState<Tab[]>(loadTabsFromStorage);
    const [activeTabId, setActiveTabId] = useState(() => {
        return localStorage.getItem(ACTIVE_TAB_KEY) || "1";
    });
    const [editingTabId, setEditingTabId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState("");

    const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

    React.useEffect(() => {
        try {
            const toSave = tabs.map(({ id, name, code }) => ({ id, name, code }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
            localStorage.setItem(ACTIVE_TAB_KEY, activeTabId);
        } catch {}
    }, [tabs, activeTabId]);

    const addTab = () => {
        const newId = Math.random().toString(36).substr(2, 9);
        setTabs([...tabs, { id: newId, name: `Query ${tabs.length + 1}`, code: "-- New Query\nSELECT ", results: null, fields: [], logs: [], executionTime: "", error: null }]);
        setActiveTabId(newId);
    };

    const closeTab = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (tabs.length === 1) return;
        const newTabs = tabs.filter(t => t.id !== id);
        setTabs(newTabs);
        if (activeTabId === id) setActiveTabId(newTabs[newTabs.length - 1].id);
    };

    const startEditing = (tab: Tab) => { setEditingTabId(tab.id); setEditingName(tab.name); };
    const saveName = () => {
        if (editingTabId) {
            setTabs(tabs.map(t => t.id === editingTabId ? { ...t, name: editingName || t.name } : t));
            setEditingTabId(null);
        }
    };

    const updateActiveTabCode = (newCode: string) => {
        setTabs(tabs.map(t => t.id === activeTabId ? { ...t, code: newCode } : t));
    };

    const handleRunQuery = useCallback(async (code: string) => {
        const startTs = new Date().toLocaleTimeString();
        setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, logs: [`[${startTs}] Executing: ${code.slice(0, 80)}...`, ...t.logs], results: null, error: null } : t));

        const t0 = performance.now();
        try {
            const result = await runSqlQuery(code);
            const elapsed = `${(performance.now() - t0).toFixed(2)}ms`;
            const ts = new Date().toLocaleTimeString();
            const safeRows = result.rows ?? [];
            const safeCount = result.rowCount ?? safeRows.length;

            setTabs(prev => prev.map(t => t.id === activeTabId ? {
                ...t,
                results: safeRows,
                fields: result.fields ?? [],
                rowCount: safeCount,
                executionTime: result.duration ? `${result.duration}ms` : elapsed,
                error: null,
                logs: [`[${ts}] Success — ${safeCount} row(s) in ${result.duration ?? elapsed}`, ...t.logs],
            } : t));

            toast.custom((t) => (<Alert variant="success" title="Query Executed" description={`Returned ${safeCount} rows`} onClose={() => toast.dismiss(t)} />));
        } catch (err: any) {
            const elapsed = `${(performance.now() - t0).toFixed(2)}ms`;
            const ts = new Date().toLocaleTimeString();
            setTabs(prev => prev.map(t => t.id === activeTabId ? {
                ...t, results: null, error: err.message, executionTime: elapsed,
                logs: [`[${ts}] Error: ${err.message}`, ...t.logs],
            } : t));
            toast.custom((t) => (<Alert variant="error" title="Query Error" description={err.message} onClose={() => toast.dismiss(t)} />));
        }
    }, [activeTabId]);

    return (
        <div className="min-h-screen bg-background text-foreground flex overflow-hidden">
            <DesktopSidebar />
            <div className="flex-1 flex flex-col min-w-0 h-screen">
                <header className="h-14 border-b border-border bg-background flex items-center justify-between px-4 shrink-0">
                    <div className="flex items-center gap-4">
                        <MobileSidebarTrigger />
                        <div className="flex items-center gap-2">
                            <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0"><IconSQLEditor className="w-4 h-4 text-primary" /></div>
                            <h1 className="text-sm font-semibold tracking-tight">SQL Editor</h1>
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" onClick={toggle} aria-label="Toggle theme">
                        {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </Button>
                </header>
                <div className="relative shrink-0 border-b border-border">
                    <div className="h-10 bg-muted/5 flex items-center px-4 overflow-x-auto overflow-y-hidden shrink-0 gap-1 pt-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    {tabs.map((tab) => (
                        <div key={tab.id} onClick={() => setActiveTabId(tab.id)} className={cn("group relative h-9 px-4 flex items-center gap-2 border-t border-x border-transparent rounded-t-lg transition-all cursor-pointer select-none min-w-[120px] max-w-[200px]", activeTabId === tab.id ? "bg-background border-border border-b-background z-10 -mb-[1px] text-foreground" : "text-muted-foreground hover:bg-muted/50")}>
                            {editingTabId === tab.id ? (
                                <input autoFocus className="bg-transparent border-none outline-none w-full text-xs font-medium" value={editingName} onChange={(e) => setEditingName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && saveName()} onClick={(e) => e.stopPropagation()} />
                            ) : (
                                <>
                                    <span className="text-xs font-medium truncate" onDoubleClick={() => startEditing(tab)}>{tab.name}</span>
                                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
                                        <button onClick={(e) => { e.stopPropagation(); startEditing(tab); }} className="hover:text-primary p-0.5 rounded"><Edit2 className="w-2.5 h-2.5" /></button>
                                        {tabs.length > 1 && <button onClick={(e) => closeTab(e, tab.id)} className="hover:text-destructive p-0.5 rounded ml-1"><X className="w-2.5 h-2.5" /></button>}
                                    </div>
                                </>
                            )}
                        </div>
                    ))}
                    <Button variant="ghost" size="icon" className="h-8 w-8 ml-1 text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-full" onClick={addTab}>
                        <Plus className="w-3.5 h-3.5" />
                    </Button>
                    </div>
                    {/* Right-fade gradient — signals more tabs are scrollable */}
                    <div className="pointer-events-none absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-background to-transparent" />
                </div>
                <main className="flex-1 overflow-hidden">
                    <ResultsPanel results={activeTab.results} logs={activeTab.logs} executionTime={activeTab.executionTime} rowCount={activeTab.rowCount} error={activeTab.error}>
                        <SqlCodeEditor key={activeTab.id} value={activeTab.code} onChange={updateActiveTabCode} onRun={handleRunQuery} />
                    </ResultsPanel>
                </main>
            </div>
        </div>
    );
}
