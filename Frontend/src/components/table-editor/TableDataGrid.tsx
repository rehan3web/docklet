import React, { useState, useRef, useEffect } from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface TableDataGridProps {
    columns: string[];
    columnTypes?: Record<string, string>;
    data: any[];
    selectedRows: Set<number>;
    onSelectRow: (index: number, selected: boolean) => void;
    onSelectAll: (selected: boolean) => void;
    onCellEdit: (rowIndex: number, column: string, value: any) => void;
}

const CustomCheckbox = React.forwardRef<
    React.ElementRef<typeof CheckboxPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
    <CheckboxPrimitive.Root
        ref={ref}
        className={cn(
            "peer h-4 w-4 shrink-0 rounded-sm border border-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 transition-colors",
            "bg-muted/80 data-[state=checked]:bg-muted-foreground/20 data-[state=checked]:border-muted-foreground/40",
            className
        )}
        {...props}
    >
        <CheckboxPrimitive.Indicator
            className={cn("flex items-center justify-center text-current")}
        >
            <Minus className="h-3.5 w-3.5 stroke-[3] text-foreground dark:text-white" />
        </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
))
CustomCheckbox.displayName = "CustomCheckbox"

export function TableDataGrid({
    columns,
    columnTypes,
    data,
    selectedRows,
    onSelectRow,
    onSelectAll,
    onCellEdit
}: TableDataGridProps) {
    const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
    const [editValue, setEditValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editingCell && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editingCell]);

    const handleDoubleClick = (row: number, col: string, value: any) => {
        setEditingCell({ row, col });
        setEditValue(value === null || value === undefined ? "" : String(value));
    };

    const handleBlur = () => {
        if (editingCell) {
            const finalValue = editValue === "" ? null : editValue;
            onCellEdit(editingCell.row, editingCell.col, finalValue);
            setEditingCell(null);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            handleBlur();
        } else if (e.key === "Escape") {
            setEditingCell(null);
        }
    };

    return (
        <div className="flex-1 overflow-auto scrollbar-modern bg-background relative border-t border-border">
            <table className="w-full border-separate border-spacing-0 table-fixed min-w-[800px]">
                <thead className="sticky top-0 z-10 bg-muted/40 backdrop-blur-sm">
                    <tr>
                        <th className="w-12 h-8 px-4 border-b border-r border-border bg-muted/20">
                            <CustomCheckbox
                                checked={selectedRows.size === data.length && data.length > 0}
                                onCheckedChange={(checked) => onSelectAll(!!checked)}
                            />
                        </th>
                        {columns.map((col) => (
                            <th
                                key={col}
                                className="h-8 px-4 border-b border-r border-border text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="truncate">{col}</span>
                                    {columnTypes?.[col] && (
                                        <span className="text-[9px] opacity-40 lowercase font-normal italic shrink-0">{columnTypes[col]}</span>
                                    )}
                                </div>
                            </th>
                        ))}
                        <th className="h-8 border-b border-border w-auto bg-muted/10" />
                    </tr>
                </thead>
                <tbody>
                    {data.map((row, rowIndex) => (
                        <tr
                            key={rowIndex}
                            className={cn(
                                "group transition-colors",
                                selectedRows.has(rowIndex) ? "bg-muted/60" : "hover:bg-muted/30"
                            )}
                        >
                            <td className="h-8 px-4 border-b border-r border-border text-center">
                                <CustomCheckbox
                                    checked={selectedRows.has(rowIndex)}
                                    onCheckedChange={(checked) => onSelectRow(rowIndex, !!checked)}
                                />
                            </td>
                            {columns.map((col) => {
                                const isEditing = editingCell?.row === rowIndex && editingCell?.col === col;
                                return (
                                    <td
                                        key={col}
                                        onDoubleClick={() => handleDoubleClick(rowIndex, col, row[col])}
                                        className={cn(
                                            "h-8 px-4 border-b border-r border-border text-xs transition-all truncate",
                                            isEditing ? "p-0 ring-1 ring-inset ring-primary z-20" : "text-muted-foreground group-hover:text-foreground"
                                        )}
                                    >
                                        {isEditing ? (
                                            <input
                                                ref={inputRef}
                                                className="w-full h-full px-4 bg-background outline-none text-xs"
                                                value={editValue}
                                                onChange={(e) => setEditValue(e.target.value)}
                                                onBlur={handleBlur}
                                                onKeyDown={handleKeyDown}
                                            />
                                        ) : (
                                            <span>{String(row[col] ?? "")}</span>
                                        )}
                                    </td>
                                );
                            })}
                            <td className="h-10 border-b border-border w-auto" />
                        </tr>
                    ))}
                    {/* Empty state rows filler */}
                    {data.length < 25 && Array.from({ length: 25 - data.length }).map((_, i) => (
                        <tr key={`empty-${i}`}>
                            <td className="h-8 border-b border-r border-border" />
                            {columns.map(col => (
                                <td key={col} className="h-8 border-b border-r border-border" />
                            ))}
                            <td className="h-8 border-b border-border" />
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
