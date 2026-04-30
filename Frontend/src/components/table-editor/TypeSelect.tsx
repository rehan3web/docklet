import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const TYPE_GROUPS = [
    { label: "Integer",     types: ["int8", "int4", "int2", "bigserial", "serial"] },
    { label: "Float",       types: ["float4", "float8", "numeric"] },
    { label: "Text",        types: ["text", "varchar", "uuid"] },
    { label: "Boolean",     types: ["bool"] },
    { label: "Date / Time", types: ["timestamptz", "timestamp", "date"] },
    { label: "JSON",        types: ["json", "jsonb"] },
    { label: "Other",       types: ["bytea"] },
];

export const ALL_TYPES = TYPE_GROUPS.flatMap(g => g.types);

interface TypeSelectProps {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    className?: string;
}

export function TypeSelect({ value, onChange, placeholder = "Choose a column type...", className }: TypeSelectProps) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dropRef    = useRef<HTMLDivElement>(null);

    const openDropdown = () => {
        if (!triggerRef.current) return;
        const r = triggerRef.current.getBoundingClientRect();
        setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 200) });
        setOpen(true);
    };

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (
                dropRef.current    && !dropRef.current.contains(e.target as Node) &&
                triggerRef.current && !triggerRef.current.contains(e.target as Node)
            ) setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    const select = (t: string) => { onChange(t); setOpen(false); };

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                onClick={openDropdown}
                className={cn(
                    "w-full flex items-center justify-between gap-2",
                    "bg-background border border-border rounded-md px-3 py-2",
                    "text-sm cursor-pointer outline-none",
                    "hover:border-muted-foreground/40 transition-colors",
                    open && "border-primary/50 ring-1 ring-primary/20",
                    value ? "text-foreground" : "text-muted-foreground/50",
                    className
                )}
            >
                <span className="truncate font-mono text-xs">{value || placeholder}</span>
                <ChevronDown className={cn(
                    "w-3.5 h-3.5 text-muted-foreground/50 shrink-0 transition-transform duration-150",
                    open && "rotate-180"
                )} />
            </button>

            {open && createPortal(
                <div
                    ref={dropRef}
                    style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
                    className={cn(
                        "bg-popover border border-border rounded-lg",
                        "overflow-hidden animate-in fade-in-0 zoom-in-95 duration-100"
                    )}
                >
                    <div className="max-h-64 overflow-y-auto scrollbar-thin py-1">
                        {TYPE_GROUPS.map(group => (
                            <div key={group.label}>
                                <div className="px-3 pt-2 pb-1 text-[9px] font-mono uppercase tracking-widest text-muted-foreground/40 select-none">
                                    {group.label}
                                </div>
                                {group.types.map(t => {
                                    const active = value === t;
                                    return (
                                        <button
                                            key={t}
                                            type="button"
                                            onClick={() => select(t)}
                                            className={cn(
                                                "w-full flex items-center justify-between px-3 py-1.5",
                                                "text-xs font-mono cursor-pointer transition-colors",
                                                active
                                                    ? "bg-muted text-foreground"
                                                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                                            )}
                                        >
                                            <span>{t}</span>
                                            {active && <Check className="w-3 h-3 text-primary shrink-0" />}
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
