import React, { useState, useEffect, useCallback } from "react";
import { X, Plus, Info, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { TypeSelect } from "./TypeSelect";

/* ── Reusable Toggle ─────────────────────────────────────────────────── */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={cn(
                "relative inline-flex w-8 h-5 rounded-full border-2 transition-colors duration-200 shrink-0 items-center px-0.5",
                checked
                    ? "bg-primary border-primary"
                    : "bg-muted border-border"
            )}
        >
            <span className={cn(
                "w-3.5 h-3.5 rounded-full bg-white shadow transition-transform duration-200",
                checked ? "translate-x-3" : "translate-x-0"
            )} />
        </button>
    );
}

/* ── Section header ──────────────────────────────────────────────────── */
function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-3">
            {children}
        </h3>
    );
}

const inputCls = cn(
    "w-full bg-background border border-border rounded-md px-3 py-2",
    "text-sm text-foreground placeholder:text-muted-foreground/40",
    "outline-none hover:border-muted-foreground/40",
    "focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors"
);

const hintCls = "text-[11px] text-muted-foreground/60 leading-relaxed mt-1";

/* ── Panel ───────────────────────────────────────────────────────────── */
interface AddColumnPanelProps {
    open: boolean;
    onClose: () => void;
    onSave: (name: string, type: string) => void;
    tableName: string;
}

export function AddColumnPanel({ open, onClose, onSave, tableName }: AddColumnPanelProps) {
    const [visible, setVisible] = useState(false);

    /* General */
    const [name, setName]             = useState("");
    const [description, setDesc]      = useState("");
    /* Data type */
    const [colType, setColType]       = useState("");
    const [isArray, setIsArray]       = useState(false);
    /* Default */
    const [defaultVal, setDefault]    = useState("");
    /* Constraints */
    const [isPrimary, setIsPrimary]   = useState(false);
    const [nullable, setNullable]     = useState(true);
    const [isUnique, setIsUnique]     = useState(false);
    /* FK */
    const [hasFk, setHasFk]          = useState(false);

    useEffect(() => {
        if (open) {
            requestAnimationFrame(() => setVisible(true));
        } else {
            setVisible(false);
        }
    }, [open]);

    const reset = () => {
        setName(""); setDesc(""); setColType(""); setIsArray(false);
        setDefault(""); setIsPrimary(false); setNullable(true); setIsUnique(false); setHasFk(false);
    };

    const handleClose = () => {
        setVisible(false);
        setTimeout(() => { reset(); onClose(); }, 300);
    };

    const handleSave = useCallback(() => {
        if (!name.trim()) return;
        onSave(name.trim(), colType || "text");
        handleClose();
    }, [name, colType]);

    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleSave();
            if (e.key === "Escape") handleClose();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [open, handleSave]);

    if (!open) return null;

    return (
        <>
            <div
                onClick={handleClose}
                className={cn(
                    "fixed inset-0 z-40 bg-black/50 transition-opacity duration-300",
                    visible ? "opacity-100" : "opacity-0"
                )}
            />

            <div className={cn(
                "fixed top-0 right-0 z-50 h-full w-full max-w-[560px] flex flex-col",
                "bg-background border-l border-border shadow-2xl",
                "transition-transform duration-300 ease-out",
                visible ? "translate-x-0" : "translate-x-full"
            )}>
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/20 shrink-0">
                    <div>
                        <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-0.5">
                            {tableName}
                        </p>
                        <h2 className="text-[15px] font-medium text-foreground">Add new column</h2>
                    </div>
                    <button onClick={handleClose} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto scrollbar-thin">

                    {/* ── General ── */}
                    <section className="px-6 py-5 border-b border-border">
                        <SectionTitle>General</SectionTitle>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">Name</label>
                                <input
                                    autoFocus
                                    type="text"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    placeholder="column_name"
                                    className={cn(inputCls, "font-mono")}
                                />
                                <p className={hintCls}>
                                    Recommended to use lowercase and use an underscore to separate words e.g. <span className="font-mono">column_name</span>
                                </p>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">
                                    Description{" "}
                                    <span className="text-muted-foreground/50 font-normal">Optional</span>
                                </label>
                                <textarea
                                    value={description}
                                    onChange={e => setDesc(e.target.value)}
                                    rows={2}
                                    className={cn(inputCls, "resize-none")}
                                />
                            </div>
                        </div>
                    </section>

                    {/* ── Data Type ── */}
                    <section className="px-6 py-5 border-b border-border">
                        <div className="flex items-center justify-between mb-3">
                            <SectionTitle>Data Type</SectionTitle>
                            <a href="#" onClick={e => e.preventDefault()}
                                className="text-[11px] text-primary hover:text-primary/80 flex items-center gap-1 transition-colors -mt-3">
                                <Info className="w-3 h-3" />
                                About data types
                            </a>
                        </div>

                        <div className="flex items-center justify-between mb-2">
                            <button
                                type="button"
                                onClick={e => e.preventDefault()}
                                className="text-[11px] text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
                            >
                                <Plus className="w-3 h-3" />
                                Create enum types
                            </button>
                        </div>

                        <label className="block text-xs font-medium text-foreground/80 mb-1.5">Type</label>
                        <TypeSelect
                            value={colType}
                            onChange={setColType}
                            placeholder="Choose a column type…"
                        />

                        {/* Define as Array */}
                        <div className={cn(
                            "flex items-start justify-between gap-4 mt-4 p-3 rounded-lg border border-border",
                            isArray && "border-primary/30 bg-primary/5"
                        )}>
                            <div className="flex-1">
                                <p className="text-xs font-medium text-foreground/80">Define as Array</p>
                                <p className={hintCls}>
                                    Allow column to be defined as variable-length multidimensional arrays
                                </p>
                            </div>
                            <Toggle checked={isArray} onChange={setIsArray} />
                        </div>
                    </section>

                    {/* ── Default Value ── */}
                    <section className="px-6 py-5 border-b border-border">
                        <SectionTitle>Default Value</SectionTitle>
                        <input
                            type="text"
                            value={defaultVal}
                            onChange={e => setDefault(e.target.value)}
                            placeholder="NULL"
                            className={cn(inputCls, "font-mono")}
                        />
                        <p className={hintCls}>
                            Can either be a literal or an expression. When using an expression wrap it in brackets,
                            e.g. <span className="font-mono">(gen_random_uuid())</span>
                        </p>
                    </section>

                    {/* ── Foreign Keys ── */}
                    <section className="px-6 py-5 border-b border-border">
                        <SectionTitle>Foreign Keys</SectionTitle>

                        {hasFk ? (
                            <div className="flex items-center gap-2 p-3 rounded border border-border bg-muted/20 mb-2">
                                <input
                                    type="text"
                                    placeholder="References table.column"
                                    className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/40 outline-none font-mono"
                                />
                                <button onClick={() => setHasFk(false)} className="text-muted-foreground/40 hover:text-destructive transition-colors">
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setHasFk(true)}
                                className={cn(
                                    "flex items-center gap-1.5 text-xs text-muted-foreground",
                                    "px-3 py-2 rounded border border-dashed border-border w-full justify-center",
                                    "hover:border-primary/40 hover:text-primary transition-all"
                                )}
                            >
                                <Plus className="w-3 h-3" />
                                Add foreign key
                            </button>
                        )}
                    </section>

                    {/* ── Constraints ── */}
                    <section className="px-6 py-5">
                        <SectionTitle>Constraints</SectionTitle>

                        <div className="space-y-3">
                            {/* Primary Key */}
                            <div className={cn(
                                "flex items-start justify-between gap-4 p-3 rounded-lg border border-border transition-colors",
                                isPrimary && "border-primary/30 bg-primary/5"
                            )}>
                                <div className="flex-1">
                                    <p className="text-xs font-medium text-foreground/80">Is Primary Key</p>
                                    <p className={hintCls}>
                                        A primary key indicates that a column or group of columns can be used as a unique identifier for rows in the table
                                    </p>
                                </div>
                                <Toggle checked={isPrimary} onChange={setIsPrimary} />
                            </div>

                            {/* Nullable */}
                            <div className={cn(
                                "flex items-start justify-between gap-4 p-3 rounded-lg border border-border transition-colors",
                                nullable && "border-border"
                            )}>
                                <div className="flex-1">
                                    <p className="text-xs font-medium text-foreground/80">Allow Nullable</p>
                                    <p className={hintCls}>
                                        Allow the column to assume a NULL value if no value is provided
                                    </p>
                                </div>
                                <Toggle checked={nullable} onChange={setNullable} />
                            </div>

                            {/* Unique */}
                            <div className={cn(
                                "flex items-start justify-between gap-4 p-3 rounded-lg border border-border transition-colors",
                                isUnique && "border-primary/30 bg-primary/5"
                            )}>
                                <div className="flex-1">
                                    <p className="text-xs font-medium text-foreground/80">Is Unique</p>
                                    <p className={hintCls}>
                                        Enforce values in the column to be unique across rows
                                    </p>
                                </div>
                                <Toggle checked={isUnique} onChange={setIsUnique} />
                            </div>
                        </div>
                    </section>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/20 shrink-0">
                    <button
                        onClick={handleClose}
                        className="px-5 py-2 rounded-full text-sm text-foreground border border-border hover:bg-muted transition-all"
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
                            disabled={!name.trim()}
                            className={cn(
                                "px-6 py-2 rounded-full text-sm font-medium transition-all",
                                name.trim()
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
