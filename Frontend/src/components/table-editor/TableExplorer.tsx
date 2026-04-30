import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
    Search, Database, MoreVertical, Plus,
    Edit2, Copy, ExternalLink, Download, FileText, Trash2, ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── SVG Icons ─────────────────────────────────────────────────────────── */

const Table2Icon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
    </svg>
);

/* ─── Custom Context Menu ────────────────────────────────────────────────── */

interface MenuAction {
    label: string;
    icon: React.ReactNode;
    onClick?: () => void;
    danger?: boolean;
    separator?: boolean;
    children?: MenuAction[];
}

interface ContextMenuProps {
    actions: MenuAction[];
    onClose: () => void;
    pos: { top: number; left: number };
}

function ContextMenu({ actions, onClose, pos }: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

    /* Adjust position so the menu doesn't go off-screen */
    const [adjusted, setAdjusted] = useState(pos);
    useEffect(() => {
        if (!menuRef.current) return;
        const r = menuRef.current.getBoundingClientRect();
        let { top, left } = pos;
        if (left + r.width > window.innerWidth - 8)  left  = window.innerWidth  - r.width - 8;
        if (top  + r.height > window.innerHeight - 8) top   = window.innerHeight - r.height - 8;
        setAdjusted({ top, left });
    }, [pos]);

    /* Close on outside click */
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [onClose]);

    /* Close on Escape */
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onClose]);

    return createPortal(
        <div
            ref={menuRef}
            style={{ position: "fixed", top: adjusted.top, left: adjusted.left, zIndex: 9999, minWidth: 192 }}
            className={cn(
                "bg-popover border border-border rounded-lg shadow-xl py-1",
                "animate-in fade-in-0 zoom-in-95 duration-100"
            )}
        >
            {actions.map((action, idx) => {
                if (action.separator) {
                    return <div key={idx} className="h-px bg-border my-1 mx-2" />;
                }

                const hasChildren = action.children && action.children.length > 0;
                const isOpen = expandedIdx === idx;

                return (
                    <div key={idx}>
                        <button
                            onClick={() => {
                                if (hasChildren) {
                                    setExpandedIdx(isOpen ? null : idx);
                                } else {
                                    action.onClick?.();
                                    onClose();
                                }
                            }}
                            className={cn(
                                "w-full flex items-center justify-between gap-2 px-3 py-2 text-[11px]",
                                "transition-colors cursor-pointer text-left",
                                action.danger
                                    ? "text-destructive hover:bg-destructive/10"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                        >
                            <span className="flex items-center gap-2">
                                <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                                    {action.icon}
                                </span>
                                {action.label}
                            </span>
                            {hasChildren && (
                                <ChevronRight className={cn(
                                    "w-3 h-3 text-muted-foreground/50 transition-transform duration-150",
                                    isOpen && "rotate-90"
                                )} />
                            )}
                        </button>

                        {/* Inline sub-items */}
                        {hasChildren && isOpen && (
                            <div className="ml-3 mr-1 mb-1 border-l border-border/60 pl-2">
                                {action.children!.map((child, cIdx) => (
                                    <button
                                        key={cIdx}
                                        onClick={() => { child.onClick?.(); onClose(); }}
                                        className={cn(
                                            "w-full flex items-center gap-2 px-2 py-1.5 text-[11px] rounded",
                                            "transition-colors cursor-pointer text-left",
                                            "text-muted-foreground hover:bg-muted hover:text-foreground"
                                        )}
                                    >
                                        <span className="w-3 h-3 flex items-center justify-center shrink-0">
                                            {child.icon}
                                        </span>
                                        {child.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>,
        document.body
    );
}

/* ─── TableExplorer ─────────────────────────────────────────────────────── */

interface TableExplorerProps {
    tables: string[];
    activeTable: string;
    onSelect: (table: string) => void;
    onDrop: (table: string) => void;
    onRename: (oldName: string) => void;
    onDuplicate: (table: string) => void;
    onOpenNewTab: (table: string) => void;
    onCreate: () => void;
    className?: string;
}

export function TableExplorer({
    tables, activeTable, onSelect, onDrop, onRename,
    onDuplicate, onOpenNewTab, onCreate, className
}: TableExplorerProps) {
    const [search, setSearch] = useState("");
    const [menuState, setMenuState] = useState<{
        table: string;
        pos: { top: number; left: number };
    } | null>(null);

    const filteredTables = tables.filter(t =>
        t.toLowerCase().includes(search.toLowerCase())
    );

    const openMenu = (table: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setMenuState({ table, pos: { top: r.bottom + 4, left: r.right - 192 } });
    };

    const buildActions = (table: string): MenuAction[] => [
        {
            label: "Rename Table",
            icon: <Edit2 className="w-3 h-3" />,
            onClick: () => onRename(table),
        },
        {
            label: "Duplicate Table",
            icon: <Copy className="w-3 h-3" />,
            onClick: () => onDuplicate(table),
        },
        {
            label: "Open in New Tab",
            icon: <ExternalLink className="w-3 h-3" />,
            onClick: () => onOpenNewTab(table),
        },
        {
            label: "Export Data",
            icon: <Download className="w-3 h-3" />,
            children: [
                {
                    label: "Export as CSV",
                    icon: <FileText className="w-3 h-3" />,
                },
                {
                    label: "Export as SQL",
                    icon: <FileText className="w-3 h-3" />,
                },
            ],
        },
        { separator: true, label: "", icon: null },
        {
            label: "Delete Table",
            icon: <Trash2 className="w-3 h-3" />,
            danger: true,
            onClick: () => onDrop(table),
        },
    ];

    return (
        <div className={cn(
            "flex flex-col h-full bg-background border-r border-border w-64 shrink-0 overflow-hidden",
            className
        )}>
            {/* Header */}
            <div className="p-4 border-b border-border bg-muted/20">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <Database className="w-3 h-3" />
                        Tables
                    </h2>
                    <button
                        onClick={onCreate}
                        className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
                        title="Create Table"
                    >
                        <Plus className="w-3 h-3" />
                    </button>
                </div>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search tables..."
                        className="w-full bg-muted/40 border border-border rounded-md py-1.5 pl-9 pr-3 text-xs outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400/40 transition-all"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
            </div>

            {/* Table list */}
            <div className="flex-1 overflow-y-auto scrollbar-modern">
                {filteredTables.map(table => {
                    const isActive = activeTable === table;
                    return (
                        <div
                            key={table}
                            onClick={() => onSelect(table)}
                            className={cn(
                                "w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium transition-all cursor-pointer group",
                                isActive
                                    ? "bg-muted text-foreground"
                                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                            )}
                        >
                            <div className="flex items-center gap-2 overflow-hidden">
                                <Table2Icon className={cn(
                                    "w-3.5 h-3.5 shrink-0",
                                    isActive ? "text-foreground" : "text-muted-foreground"
                                )} />
                                <span className="truncate">{table}</span>
                            </div>

                            <div className={cn(
                                "flex items-center gap-1 transition-opacity",
                                isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                            )}>
                                <button
                                    onClick={e => openMenu(table, e)}
                                    className={cn(
                                        "p-1 rounded transition-colors",
                                        "text-muted-foreground hover:text-foreground hover:bg-muted"
                                    )}
                                >
                                    <MoreVertical className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    );
                })}

                {filteredTables.length === 0 && (
                    <div className="p-4 text-center text-xs text-muted-foreground italic">
                        No tables found
                    </div>
                )}
            </div>

            {/* Custom context menu */}
            {menuState && (
                <ContextMenu
                    actions={buildActions(menuState.table)}
                    pos={menuState.pos}
                    onClose={() => setMenuState(null)}
                />
            )}
        </div>
    );
}
