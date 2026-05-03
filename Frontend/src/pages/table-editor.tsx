import React, { useState, useEffect, useMemo } from "react";
import { DesktopSidebar, MobileSidebarTrigger, IconTableEditor } from "@/components/AppSidebar";
import { TableExplorer } from "@/components/table-editor/TableExplorer";
import { TableDataGrid } from "@/components/table-editor/TableDataGrid";
import { TableToolbar } from "@/components/table-editor/TableToolbar";
import { CreateTablePanel } from "@/components/table-editor/CreateTablePanel";
import { InsertRowPanel } from "@/components/table-editor/InsertRowPanel";
import { AddColumnPanel } from "@/components/table-editor/AddColumnPanel";
import { Sun, Moon, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, copyToClipboard } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import {
    Drawer, DrawerContent, DrawerTrigger, DrawerTitle, DrawerHeader
} from "@/components/ui/drawer";
import {
    useGetTableNames, useGetTableDetails, useGetTableData,
    createTable, dropTable, renameTable, duplicateTable,
    insertRow, updateRow, deleteRow, addColumn,
} from "@/api/client";
import { useQueryClient } from "@tanstack/react-query";

const TablesTriggerIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <rect width="18" height="18" x="3" y="3" rx="2"></rect>
        <path d="M9 3v18"></path>
        <path d="m16 15-3-3 3-3"></path>
    </svg>
);

const Table2Icon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"></path>
    </svg>
);

function TableContent({ activeTable, onSchemaRefresh }: { activeTable: string; onSchemaRefresh: () => void }) {
    const qc = useQueryClient();
    const { data: schemaData, isLoading: schemaLoading } = useGetTableDetails(activeTable);
    const { data: tableDataResult, isLoading: dataLoading, refetch: refetchData } = useGetTableData(activeTable, { limit: 100, offset: 0 });

    const columnMetas = useMemo(() => schemaData?.columns || [], [schemaData]);
    const columns = useMemo(() => columnMetas.map((c: any) => c.column_name), [columnMetas]);
    const columnTypes = useMemo(() => Object.fromEntries(columnMetas.map((c: any) => [c.column_name, c.data_type])), [columnMetas]);
    const data = tableDataResult?.data || [];
    const totalCount = tableDataResult?.totalCount || 0;
    const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

    useEffect(() => { setSelectedRows(new Set()); }, [activeTable]);

    const handleSelectRow = (index: number, selected: boolean) => {
        const next = new Set(selectedRows);
        if (selected) next.add(index);
        else next.delete(index);
        setSelectedRows(next);
    };

    const handleSelectAll = (selected: boolean) => {
        setSelectedRows(selected ? new Set(data.map((_: any, i: number) => i)) : new Set());
    };

    const handleCellEdit = async (rowIndex: number, column: string, value: any) => {
        const row = data[rowIndex];
        if (!row) return;
        const pkCol = schemaData?.constraints?.find((c: any) => c.constraint_type === 'PRIMARY KEY')?.column_name;

        // Block editing primary key or identity/serial columns
        const colMeta = columnMetas.find((c: any) => c.column_name === column);
        const isSerial = typeof colMeta?.column_default === 'string' && colMeta.column_default.startsWith('nextval(');
        const isIdentity = colMeta?.is_identity === 'YES';
        if (column === pkCol || isSerial || isIdentity) {
            toast.custom((t) => (<Alert variant="warning" description={`"${column}" is auto-generated and cannot be edited.`} onClose={() => toast.dismiss(t)} />));
            return;
        }

        const selection = pkCol ? { [pkCol]: row[pkCol] } : columns.reduce((a: any, c: string) => ({ ...a, [c]: row[c] }), {});
        try {
            await updateRow(activeTable, selection, { [column]: value });
            await refetchData();
            toast.custom((t) => (<Alert variant="info" description={`Updated ${column}`} onClose={() => toast.dismiss(t)} />));
        } catch (err: any) {
            toast.custom((t) => (<Alert variant="error" description={err.message} onClose={() => toast.dismiss(t)} />));
        }
    };

    const [insertOpen, setInsertOpen] = useState(false);
    const [addColOpen, setAddColOpen] = useState(false);

    const handleSaveRow = async (rowData: Record<string, any>) => {
        try {
            await insertRow(activeTable, rowData);
            await qc.invalidateQueries({ queryKey: ["db-table-data", activeTable] });
            await refetchData();
            toast.custom((t) => (<Alert variant="success" description="Row inserted successfully." onClose={() => toast.dismiss(t)} />));
            setInsertOpen(false);
        } catch (err: any) {
            toast.custom((t) => (<Alert variant="error" description={err.message} onClose={() => toast.dismiss(t)} />));
        }
    };

    const handleSaveColumn = async (colName: string, colType: string) => {
        try {
            await addColumn(activeTable, colName, colType, undefined, true);
            onSchemaRefresh();
            qc.invalidateQueries({ queryKey: ["db-table", activeTable] });
            toast.custom((t) => (<Alert variant="success" description={`Column "${colName}" added.`} onClose={() => toast.dismiss(t)} />));
            setAddColOpen(false);
        } catch (err: any) {
            toast.custom((t) => (<Alert variant="error" description={err.message} onClose={() => toast.dismiss(t)} />));
        }
    };

    const handleDeleteRows = async () => {
        const pkCol = schemaData?.constraints?.find((c: any) => c.constraint_type === 'PRIMARY KEY')?.column_name;
        const rowsToDelete = data.filter((_: any, i: number) => selectedRows.has(i));
        try {
            for (const row of rowsToDelete) {
                const selection = pkCol ? { [pkCol]: row[pkCol] } : columns.reduce((a: any, c: string) => ({ ...a, [c]: row[c] }), {});
                await deleteRow(activeTable, selection);
            }
            await refetchData();
            setSelectedRows(new Set());
            toast.custom((t) => (<Alert variant="error" description={`Removed ${rowsToDelete.length} row(s).`} onClose={() => toast.dismiss(t)} />));
        } catch (err: any) {
            toast.custom((t) => (<Alert variant="error" description={err.message} onClose={() => toast.dismiss(t)} />));
        }
    };

    const generateCSV = (rows: any[]) => {
        const header = columns.join(",");
        const body = rows.map((row: any) => columns.map((col: string) => `"${String(row[col] ?? "")}"`).join(",")).join("\n");
        return `${header}\n${body}`;
    };

    const generateSQL = (rows: any[]) => {
        return rows.map((row: any) => {
            const vals = columns.map((col: string) => `'${String(row[col] ?? "").replace(/'/g, "''")}'`).join(", ");
            return `INSERT INTO ${activeTable} (${columns.join(", ")}) VALUES (${vals});`;
        }).join("\n");
    };

    const downloadFile = (content: string, filename: string) => {
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    };

    const handleExportCsv = () => {
        const rows = selectedRows.size > 0 ? data.filter((_: any, i: number) => selectedRows.has(i)) : data;
        downloadFile(generateCSV(rows), `${activeTable}_export.csv`);
        toast.custom((t) => (<Alert variant="success" description={`Downloaded ${rows.length} rows.`} onClose={() => toast.dismiss(t)} />));
    };

    const handleExportSql = () => {
        const rows = selectedRows.size > 0 ? data.filter((_: any, i: number) => selectedRows.has(i)) : data;
        downloadFile(generateSQL(rows), `${activeTable}_export.sql`);
        toast.custom((t) => (<Alert variant="success" description={`Downloaded ${rows.length} rows.`} onClose={() => toast.dismiss(t)} />));
    };

    const handleCopyRows = () => {
        const rows = selectedRows.size > 0 ? data.filter((_: any, i: number) => selectedRows.has(i)) : data;
        copyToClipboard(JSON.stringify(rows, null, 2));
        toast.custom((t) => (<Alert variant="info" description={`JSON for ${rows.length} rows copied.`} onClose={() => toast.dismiss(t)} />));
    };

    if (schemaLoading || dataLoading) {
        return (
            <div className="flex-1 p-6 space-y-3">
                <Skeleton className="h-8 w-full bg-muted" />
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full bg-muted" />)}
            </div>
        );
    }

    return (
        <>
            <TableToolbar onAddRow={() => setInsertOpen(true)} onAddColumn={() => setAddColOpen(true)} onDeleteRows={handleDeleteRows} onExportCsv={handleExportCsv} onExportSql={handleExportSql} onCopyRows={handleCopyRows} selectionCount={selectedRows.size} />
            <div className="flex-1 flex flex-col overflow-hidden">
                <TableDataGrid columns={columns} columnTypes={columnTypes} data={data} selectedRows={selectedRows} onSelectRow={handleSelectRow} onSelectAll={handleSelectAll} onCellEdit={handleCellEdit} />
            </div>
            <div className="h-8 border-t border-border bg-background flex items-center justify-between px-4 shrink-0">
                <div className="flex items-center gap-4">
                    <span className="text-[10px] text-muted-foreground font-mono">{totalCount} Rows</span>
                    <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest bg-muted/50 px-1.5 py-0.5 rounded">Active</span>
                </div>
                <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">PostgreSQL</span>
                </div>
            </div>
            <InsertRowPanel open={insertOpen} onClose={() => setInsertOpen(false)} onSave={handleSaveRow} tableName={activeTable} columns={columnMetas} />
            <AddColumnPanel open={addColOpen} onClose={() => setAddColOpen(false)} onSave={handleSaveColumn} tableName={activeTable} />
        </>
    );
}

export default function TableEditorPage() {
    const { theme, toggle } = useTheme();
    const isMobile = useIsMobile();
    const qc = useQueryClient();
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [isCreatePanelOpen, setIsCreatePanelOpen] = useState(false);
    const [openTabs, setOpenTabs] = useState<string[]>([]);
    const [activeTabIndex, setActiveTabIndex] = useState(0);

    const { data: tableRows, refetch: refetchTables } = useGetTableNames();
    const tables = tableRows?.map((r: any) => r.table_name) || [];

    useEffect(() => {
        if (tables.length > 0 && openTabs.length === 0) {
            setOpenTabs([tables[0]]);
            setActiveTabIndex(0);
        }
    }, [tables.length]);

    const activeTable = openTabs[activeTabIndex] || openTabs[0] || "";

    const handleTableSelect = (table: string) => {
        const idx = openTabs.indexOf(table);
        if (idx !== -1) { setActiveTabIndex(idx); }
        else { const next = [...openTabs, table]; setOpenTabs(next); setActiveTabIndex(next.length - 1); }
        if (isMobile) setIsDrawerOpen(false);
    };

    const handleOpenNewTab = (table: string) => {
        const next = [...openTabs, table];
        setOpenTabs(next);
        setActiveTabIndex(next.length - 1);
    };

    const handleCloseTab = (index: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (openTabs.length === 1) return;
        const newTabs = openTabs.filter((_, i) => i !== index);
        setOpenTabs(newTabs);
        if (activeTabIndex >= index) setActiveTabIndex(Math.max(0, activeTabIndex - 1));
    };

    const handleCreateTable = async (tableName: string, columns: any[]) => {
        try {
            await createTable(tableName, columns);
            await refetchTables();
            qc.invalidateQueries({ queryKey: ["db-schema"] });
            const next = [...openTabs, tableName];
            setOpenTabs(next);
            setActiveTabIndex(next.length - 1);
            toast.custom((t) => (<Alert variant="success" description={`Table "${tableName}" created.`} onClose={() => toast.dismiss(t)} />));
        } catch (err: any) {
            toast.custom((t) => (<Alert variant="error" description={err.message} onClose={() => toast.dismiss(t)} />));
        }
    };

    const handleDrop = async (table: string) => {
        try {
            await dropTable(table);
            await refetchTables();
            qc.invalidateQueries({ queryKey: ["db-schema"] });
            const newTabs = openTabs.filter(t => t !== table);
            setOpenTabs(newTabs.length > 0 ? newTabs : []);
            setActiveTabIndex(0);
            toast.custom((t) => (<Alert variant="error" description={`Table "${table}" dropped.`} onClose={() => toast.dismiss(t)} />));
        } catch (err: any) {
            toast.custom((t) => (<Alert variant="error" description={err.message} onClose={() => toast.dismiss(t)} />));
        }
    };

    const handleRename = async (table: string) => {
        const n = prompt("New table name:", table);
        if (!n || n === table) return;
        try {
            await renameTable(table, n);
            await refetchTables();
            setOpenTabs(openTabs.map(t => t === table ? n : t));
            toast.custom((t) => (<Alert variant="success" description={`Renamed to "${n}".`} onClose={() => toast.dismiss(t)} />));
        } catch (err: any) {
            toast.custom((t) => (<Alert variant="error" description={err.message} onClose={() => toast.dismiss(t)} />));
        }
    };

    const handleDuplicate = async (table: string) => {
        try {
            const result = await duplicateTable(table);
            await refetchTables();
            toast.custom((t) => (<Alert variant="success" description={`Duplicated as "${result.newTableName}".`} onClose={() => toast.dismiss(t)} />));
        } catch (err: any) {
            toast.custom((t) => (<Alert variant="error" description={err.message} onClose={() => toast.dismiss(t)} />));
        }
    };

    const explorerProps = {
        tables,
        activeTable,
        onSelect: handleTableSelect,
        onOpenNewTab: handleOpenNewTab,
        onDrop: handleDrop,
        onRename: handleRename,
        onDuplicate: handleDuplicate,
        onCreate: () => setIsCreatePanelOpen(true),
    };

    return (
        <div className="min-h-screen bg-background text-foreground flex overflow-hidden">
            <DesktopSidebar />
            <div className="flex-1 flex flex-col min-w-0 h-screen">
                <header className="h-14 border-b border-border bg-background flex items-center justify-between px-4 shrink-0 z-20">
                    <div className="flex items-center gap-4">
                        <MobileSidebarTrigger />
                        <div className="flex items-center gap-2">
                            <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0"><IconTableEditor className="w-4 h-4 text-primary" /></div>
                            <h1 className="text-sm font-semibold tracking-tight">Table Editor</h1>
                        </div>
                        {isMobile && (
                            <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
                                <DrawerTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-8 gap-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted ml-2">
                                        <TablesTriggerIcon className="w-4 h-4" /><span>Tables</span>
                                    </Button>
                                </DrawerTrigger>
                                <DrawerContent className="h-[70vh]">
                                    <DrawerHeader className="border-b border-border px-4 py-3"><DrawerTitle className="text-sm font-semibold text-left">Browse Tables</DrawerTitle></DrawerHeader>
                                    <div className="flex-1 overflow-hidden"><TableExplorer {...explorerProps} className="w-full border-r-0" /></div>
                                </DrawerContent>
                            </Drawer>
                        )}
                    </div>
                    <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground transition-colors" onClick={toggle}>
                        {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </Button>
                </header>

                <div className="flex-1 flex overflow-hidden">
                    {!isMobile && <TableExplorer {...explorerProps} />}
                    <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-muted/5">
                        <div className="h-10 bg-background border-b border-border flex items-stretch overflow-x-auto overflow-y-hidden scrollbar-modern shrink-0">
                            {openTabs.map((tabName, idx) => (
                                <div key={`${tabName}-${idx}`} onClick={() => setActiveTabIndex(idx)} className={cn("relative h-full px-4 flex items-center gap-2 text-[11px] font-medium transition-colors cursor-pointer select-none group whitespace-nowrap border-r border-border/40", activeTabIndex === idx ? "text-foreground" : "text-muted-foreground hover:text-foreground/70")}>
                                    {activeTabIndex === idx && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t-sm" />}
                                    <Table2Icon className={cn("w-3.5 h-3.5 shrink-0", activeTabIndex === idx ? "text-foreground" : "text-muted-foreground")} />
                                    <span>{tabName}</span>
                                    {openTabs.length > 1 && (
                                        <button onClick={(e) => handleCloseTab(idx, e)} className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-muted-foreground/10 rounded transition-all">
                                            <X className="w-2.5 h-2.5" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                        {activeTable ? (
                            <TableContent key={activeTable} activeTable={activeTable} onSchemaRefresh={() => refetchTables()} />
                        ) : (
                            <div className="flex-1 flex items-center justify-center">
                                <div className="text-center">
                                    <p className="text-muted-foreground text-sm">No tables found.</p>
                                    <p className="text-muted-foreground text-xs mt-1">Create a table to get started.</p>
                                    <Button variant="outline" size="sm" className="mt-4 text-xs" onClick={() => setIsCreatePanelOpen(true)}>Create Table</Button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <CreateTablePanel open={isCreatePanelOpen} onClose={() => setIsCreatePanelOpen(false)} onCreate={handleCreateTable} />
        </div>
    );
}
