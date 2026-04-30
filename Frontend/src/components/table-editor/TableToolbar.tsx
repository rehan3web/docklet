import React from "react";
import {
    Plus,
    Download,
    Copy,
    Share2,
    ChevronDown,
    Columns,
    Rows,
    FileJson,
    FileCode,
    FileType
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";

interface TableToolbarProps {
    onAddRow: () => void;
    onAddColumn: () => void;
    onDeleteRows: () => void;
    onExportCsv: () => void;
    onExportSql: () => void;
    onCopyRows: () => void;
    selectionCount: number;
}

const TrashIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <path d="M3 6h18"></path>
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
    </svg>
);

export function TableToolbar({
    onAddRow,
    onAddColumn,
    onDeleteRows,
    onExportCsv,
    onExportSql,
    onCopyRows,
    selectionCount
}: TableToolbarProps) {
    return (
        <div className="h-14 px-4 bg-background border-b border-border flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
                <Button
                    variant="default"
                    size="sm"
                    className="h-8 gap-2 border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none hover:shadow-sm transition-all text-xs font-medium"
                    onClick={onAddRow}
                >
                    <Rows className="w-3.5 h-3.5" />
                    <span className="">Insert Row</span>
                </Button>
                <Button
                    variant="default"
                    size="sm"
                    className="h-8 gap-2 border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none hover:shadow-sm transition-all text-xs font-medium"
                    onClick={onAddColumn}
                >
                    <Columns className="w-3.5 h-3.5" />
                    <span className="">Insert Column</span>
                </Button>
            </div>

            <div className="flex items-center gap-2">
                {selectionCount > 0 && (
                    <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200">
                        <span className="text-xs text-muted-foreground mr-2 font-medium">
                            {selectionCount} selected
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-2 text-xs font-medium bg-transparent border-black dark:border-white hover:bg-muted"
                            onClick={onDeleteRows}
                        >
                            <TrashIcon className="w-3 h-3" />
                            Delete
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="h-8 gap-2 border-border hover:bg-muted text-xs font-medium">
                                    <Download className="w-3.5 h-3.5" />
                                    Export Selected
                                    <ChevronDown className="w-3.5 h-3.5 opacity-50" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem onClick={onExportCsv} className="gap-2">
                                    <FileType className="w-4 h-4" /> Export to CSV
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={onExportSql} className="gap-2">
                                    <FileCode className="w-4 h-4" /> Export to SQL
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={onCopyRows} className="gap-2">
                                    <Copy className="w-4 h-4" /> Copy as JSON
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}

                <div className="h-4 w-[1px] bg-border mx-2" />

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-normal text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
                            <Download className="w-3 h-3 opacity-60" />
                            Export
                            <ChevronDown className="w-2.5 h-2.5 opacity-40" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40 p-1">
                        <DropdownMenuItem onClick={onExportCsv} className="gap-2 text-[11px] font-normal text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-sm cursor-pointer">
                            <FileType className="w-3 h-3 opacity-60" /> CSV Export
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onExportSql} className="gap-2 text-[11px] font-normal text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-sm cursor-pointer">
                            <FileCode className="w-3 h-3 opacity-60" /> SQL Export
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>


            </div>
        </div>
    );
}
