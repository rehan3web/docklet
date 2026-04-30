import React, { useState, useEffect, useCallback } from "react";
import { X, Plus, Trash2, Key, Link2, Upload, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { TypeSelect } from "./TypeSelect";

interface ColumnDef {
    id: string;
    name: string;
    type: string;
    defaultValue: string;
    isPrimary: boolean;
}

interface ForeignKey {
    id: string;
    column: string;
    refTable: string;
    refColumn: string;
}

interface CreateTablePanelProps {
    open: boolean;
    onClose: () => void;
    onCreate: (tableName: string, columns: ColumnDef[]) => void;
}

function generateId() {
    return Math.random().toString(36).slice(2, 9);
}

const DEFAULT_COLUMNS: ColumnDef[] = [
    { id: "col-id", name: "id",         type: "bigserial",  defaultValue: "",      isPrimary: true  },
    { id: "col-ts", name: "created_at", type: "timestamptz",defaultValue: "now()", isPrimary: false },
];

/* ─── Shared input style ──────────────────────────────────────────────── */
const inputCls = cn(
    "w-full bg-background border border-border rounded px-2.5 py-1.5",
    "text-xs text-foreground font-mono placeholder:text-muted-foreground/40",
    "outline-none hover:border-muted-foreground/40",
    "focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors"
);

/* ─── Main Panel ───────────────────────────────────────────────────────── */
export function CreateTablePanel({ open, onClose, onCreate }: CreateTablePanelProps) {
    const [tableName,   setTableName]   = useState("");
    const [description, setDescription] = useState("");
    const [columns,     setColumns]     = useState<ColumnDef[]>(DEFAULT_COLUMNS);
    const [foreignKeys, setForeignKeys] = useState<ForeignKey[]>([]);
    const [csvFile,     setCsvFile]     = useState<File | null>(null);
    const [visible,     setVisible]     = useState(false);

    useEffect(() => {
        if (open) requestAnimationFrame(() => setVisible(true));
        else setVisible(false);
    }, [open]);

    const reset = () => {
        setTableName(""); setDescription("");
        setColumns(DEFAULT_COLUMNS); setForeignKeys([]); setCsvFile(null);
    };

    const handleClose = () => {
        setVisible(false);
        setTimeout(() => { reset(); onClose(); }, 300);
    };

    const handleSave = useCallback(() => {
        if (!tableName.trim()) return;
        onCreate(tableName.trim(), columns);
        handleClose();
    }, [tableName, columns]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleSave();
        if (e.key === "Escape") handleClose();
    }, [handleSave]);

    useEffect(() => {
        if (!open) return;
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [open, handleKeyDown]);

    const addColumn = () => setColumns(prev => [...prev, {
        id: generateId(), name: "", type: "text", defaultValue: "NULL", isPrimary: false,
    }]);

    const updateColumn = (id: string, field: keyof ColumnDef, value: string | boolean) =>
        setColumns(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));

    const removeColumn = (id: string) =>
        setColumns(prev => prev.filter(c => c.id !== id));

    const addForeignKey = () =>
        setForeignKeys(prev => [...prev, { id: generateId(), column: "", refTable: "", refColumn: "" }]);

    const removeForeignKey = (id: string) =>
        setForeignKeys(prev => prev.filter(fk => fk.id !== id));

    if (!open) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                onClick={handleClose}
                className={cn(
                    "fixed inset-0 z-40 bg-black/50 transition-opacity duration-300",
                    visible ? "opacity-100" : "opacity-0"
                )}
            />

            {/* Slide-over Panel */}
            <div className={cn(
                "fixed top-0 right-0 z-50 h-full w-full max-w-[620px] flex flex-col",
                "bg-background border-l border-border shadow-2xl",
                "transition-transform duration-300 ease-out",
                visible ? "translate-x-0" : "translate-x-full"
            )}>

                {/* ── Header ── */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/20 shrink-0">
                    <div>
                        <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-0.5">
                            public
                        </p>
                        <h2 className="text-[15px] font-medium text-foreground">Create a new table</h2>
                    </div>
                    <button
                        onClick={handleClose}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* ── Scrollable Body ── */}
                <div className="flex-1 overflow-y-auto scrollbar-thin">

                    {/* Name & Description */}
                    <section className="px-6 py-5 border-b border-border">
                        <div className="mb-4">
                            <label className="block text-xs font-medium text-foreground/80 mb-1.5">Name</label>
                            <input
                                autoFocus
                                type="text"
                                value={tableName}
                                onChange={e => setTableName(e.target.value)}
                                placeholder="table_name"
                                className={cn(
                                    "w-full bg-background border rounded-md px-3 py-2 text-sm text-foreground",
                                    "font-mono placeholder:text-muted-foreground/40 outline-none transition-colors",
                                    "hover:border-muted-foreground/40",
                                    "focus:border-primary/50 focus:ring-1 focus:ring-primary/20",
                                    tableName ? "border-border" : "border-border"
                                )}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-foreground/80 mb-1.5">
                                Description{" "}
                                <span className="text-muted-foreground/50 font-normal">(optional)</span>
                            </label>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder="A short description of your table"
                                rows={2}
                                className={cn(
                                    "w-full bg-background border border-border rounded-md px-3 py-2",
                                    "text-sm text-foreground placeholder:text-muted-foreground/40",
                                    "outline-none resize-none transition-colors",
                                    "hover:border-muted-foreground/40",
                                    "focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                                )}
                            />
                        </div>
                    </section>

                    {/* Columns */}
                    <section className="px-6 py-5 border-b border-border">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Columns
                            </h3>
                            <a
                                href="#"
                                onClick={e => e.preventDefault()}
                                className="text-[11px] text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
                            >
                                <Info className="w-3 h-3" />
                                About data types
                            </a>
                        </div>

                        {/* Column header row */}
                        <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: "1fr 140px 110px 32px 32px" }}>
                            {["Name", "Type", "Default"].map(h => (
                                <span key={h} className="text-[10px] text-muted-foreground/50 uppercase tracking-wider font-mono px-1">
                                    {h}
                                </span>
                            ))}
                            <span className="text-[10px] text-muted-foreground/50 flex items-center justify-center">
                                <Key className="w-3 h-3" />
                            </span>
                            <span />
                        </div>

                        {/* Column rows */}
                        <div className="space-y-1.5">
                            {columns.map(col => (
                                <div
                                    key={col.id}
                                    className="grid gap-2 items-center"
                                    style={{ gridTemplateColumns: "1fr 140px 110px 32px 32px" }}
                                >
                                    {/* Name */}
                                    <input
                                        type="text"
                                        value={col.name}
                                        onChange={e => updateColumn(col.id, "name", e.target.value)}
                                        placeholder="column_name"
                                        className={cn(
                                            inputCls,
                                            col.isPrimary && "border-primary/40"
                                        )}
                                    />

                                    {/* Custom type dropdown */}
                                    <TypeSelect
                                        value={col.type}
                                        onChange={v => updateColumn(col.id, "type", v)}
                                    />

                                    {/* Default value */}
                                    <input
                                        type="text"
                                        value={col.defaultValue}
                                        onChange={e => updateColumn(col.id, "defaultValue", e.target.value)}
                                        placeholder="NULL"
                                        className={inputCls}
                                    />

                                    {/* Primary key toggle */}
                                    <button
                                        onClick={() => updateColumn(col.id, "isPrimary", !col.isPrimary)}
                                        title="Toggle primary key"
                                        className={cn(
                                            "w-8 h-7 flex items-center justify-center rounded border transition-all",
                                            col.isPrimary
                                                ? "bg-primary/10 border-primary/40 text-primary"
                                                : "border-border text-muted-foreground/40 hover:border-muted-foreground/50 hover:text-muted-foreground"
                                        )}
                                    >
                                        <Key className="w-3 h-3" />
                                    </button>

                                    {/* Delete */}
                                    <button
                                        onClick={() => removeColumn(col.id)}
                                        disabled={col.id === "col-id"}
                                        className={cn(
                                            "w-8 h-7 flex items-center justify-center rounded border border-transparent transition-all",
                                            col.id === "col-id"
                                                ? "text-muted-foreground/20 cursor-not-allowed"
                                                : "text-muted-foreground/40 hover:border-destructive/30 hover:text-destructive hover:bg-destructive/5"
                                        )}
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                        </div>

                        <button
                            onClick={addColumn}
                            className={cn(
                                "mt-3 flex items-center gap-1.5 text-xs text-muted-foreground",
                                "px-2 py-1.5 rounded border border-dashed border-border",
                                "hover:border-primary/40 hover:text-primary transition-all w-full justify-center"
                            )}
                        >
                            <Plus className="w-3 h-3" />
                            Add column
                        </button>
                    </section>

                    {/* Foreign Keys */}
                    <section className="px-6 py-5 border-b border-border">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                            Foreign keys
                        </h3>

                        {foreignKeys.length > 0 && (
                            <div className="space-y-2 mb-3">
                                {foreignKeys.map(fk => (
                                    <div
                                        key={fk.id}
                                        className="flex items-center gap-2 p-3 rounded border border-border bg-muted/20"
                                    >
                                        <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                        <input
                                            type="text"
                                            placeholder="column"
                                            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/40 outline-none font-mono"
                                        />
                                        <span className="text-muted-foreground/50 text-xs">→</span>
                                        <input
                                            type="text"
                                            placeholder="table.column"
                                            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/40 outline-none font-mono"
                                        />
                                        <button
                                            onClick={() => removeForeignKey(fk.id)}
                                            className="text-muted-foreground/40 hover:text-destructive transition-colors"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <button
                            onClick={addForeignKey}
                            className={cn(
                                "flex items-center gap-1.5 text-xs text-muted-foreground",
                                "px-2 py-1.5 rounded border border-dashed border-border",
                                "hover:border-primary/40 hover:text-primary transition-all w-full justify-center"
                            )}
                        >
                            <Plus className="w-3 h-3" />
                            Add foreign key relation
                        </button>
                    </section>

                    {/* Import from CSV */}
                    <section className="px-6 py-5">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                            Import data from CSV
                        </h3>
                        <label className={cn(
                            "flex flex-col items-center justify-center gap-2 w-full h-20",
                            "rounded-lg border border-dashed cursor-pointer transition-all",
                            csvFile
                                ? "border-primary/40 bg-primary/5"
                                : "border-border hover:border-muted-foreground/40 hover:bg-muted/20"
                        )}>
                            <input
                                type="file"
                                accept=".csv"
                                className="hidden"
                                onChange={e => setCsvFile(e.target.files?.[0] ?? null)}
                            />
                            <Upload className={cn("w-4 h-4", csvFile ? "text-primary" : "text-muted-foreground/40")} />
                            {csvFile ? (
                                <span className="text-xs text-primary font-mono">{csvFile.name}</span>
                            ) : (
                                <span className="text-xs text-muted-foreground/50">
                                    Click to upload or drag &amp; drop a CSV
                                </span>
                            )}
                        </label>
                    </section>
                </div>

                {/* ── Footer ── */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/20 shrink-0">
                    <button
                        onClick={handleClose}
                        className={cn(
                            "px-5 py-2 rounded-full text-sm text-foreground border border-border",
                            "hover:bg-muted transition-all"
                        )}
                    >
                        Cancel
                    </button>

                    <div className="flex items-center gap-3">
                        <span className="text-[10px] text-muted-foreground/50 font-mono hidden sm:flex items-center gap-1">
                            <kbd className="bg-muted border border-border rounded px-1.5 py-0.5 text-[10px]">Ctrl</kbd>
                            <kbd className="bg-muted border border-border rounded px-1.5 py-0.5 text-[10px]">↵</kbd>
                        </span>
                        <button
                            onClick={handleSave}
                            disabled={!tableName.trim()}
                            className={cn(
                                "px-6 py-2 rounded-full text-sm font-medium transition-all",
                                tableName.trim()
                                    ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_16px_rgba(62,207,142,0.2)]"
                                    : "bg-muted text-muted-foreground border border-border cursor-not-allowed"
                            )}
                        >
                            Save
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
