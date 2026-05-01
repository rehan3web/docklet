import React, { useState, useEffect, useRef, useCallback } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-sql";
import { Play, Copy, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, copyToClipboard } from "@/lib/utils";

// Prism theme styles for darkness (minimalist)
const prismStyles = `
  .code-editor-pre,
  .code-editor-textarea {
    font-family: 'Source Code Pro', Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace !important;
    font-size: 14px !important;
    line-height: 24px !important;
    padding: 16px !important;
    tab-size: 4;
    white-space: pre !important;
    word-break: keep-all !important;
    overflow-wrap: normal !important;
    overflow: hidden !important; /* Prevent internal scrolling */
  }

  .code-editor-pre {
    color: hsl(var(--foreground));
    margin: 0;
    pointer-events: none;
    border: none;
    background: transparent !important;
  }

  /* Syntax Highlighting */
  .token.comment, .token.prolog, .token.doctype, .token.cdata { color: #919090; font-style: italic; }
  .token.punctuation { color: #a1a1a1; }
  .token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol, .token.deleted { color: #f43f5e; }
  .token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted { color: #10b981; }
  .token.operator, .token.entity, .token.url, .language-css .token.string, .style .token.string { color: #3b82f6; }
  .token.atrule, .token.attr-value, .token.keyword { color: #3b82f6; font-weight: 600; }
  .token.function, .token.class-name { color: #8b5cf6; }
  .token.regex, .token.important, .token.variable { color: #f59e0b; }
`;

const SQL_KEYWORDS = [
    "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER",
    "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "ON", "GROUP BY", "ORDER BY",
    "HAVING", "LIMIT", "OFFSET", "AND", "OR", "NOT", "IN", "LIKE", "BETWEEN", "IS NULL",
    "AS", "DISTINCT", "COUNT", "SUM", "AVG", "MIN", "MAX", "TABLE", "INTO", "VALUES", "SET"
];

const MOCK_TABLES = ["users", "profiles", "orders", "products", "transactions", "audit_logs"];
const MOCK_COLUMNS: Record<string, string[]> = {
    users: ["id", "email", "full_name", "created_at", "updated_at"],
    profiles: ["id", "user_id", "avatar_url", "bio"],
    orders: ["id", "user_id", "total_amount", "status", "created_at"],
    products: ["id", "name", "price", "stock_quantity", "category"],
};

interface SqlCodeEditorProps {
    onRun: (code: string) => void;
    initialValue?: string;
    value?: string;
    onChange?: (value: string) => void;
}

export function SqlCodeEditor({ onRun, initialValue = "", value: controlledValue, onChange: controlledOnChange }: SqlCodeEditorProps) {
    const [internalCode, setInternalCode] = useState(initialValue || "");
    const code = controlledValue !== undefined ? controlledValue : internalCode;
    const setCode = (newValue: string) => {
        if (controlledOnChange) {
            controlledOnChange(newValue);
        } else {
            setInternalCode(newValue);
        }
    };
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [suggestionIndex, setSuggestionIndex] = useState(0);
    const [suggestionPos, setSuggestionPos] = useState({ top: 0, left: 0 });
    const [showSuggestions, setShowSuggestions] = useState(false);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const preRef = useRef<HTMLPreElement>(null);

    const highlightedCode = React.useMemo(() => {
        return Prism.highlight(code || " ", Prism.languages.sql, "sql");
    }, [code]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        setCode(value);

        // Suggestion logic
        const cursorPos = e.target.selectionStart;
        const lastWord = value.slice(0, cursorPos).split(/[\s,()]+/).pop() || "";

        if (lastWord.length > 1) {
            const filtered = [
                ...SQL_KEYWORDS,
                ...MOCK_TABLES,
                ...Object.values(MOCK_COLUMNS).flat()
            ].filter(k => k.toLowerCase().startsWith(lastWord.toLowerCase()) && k.toLowerCase() !== lastWord.toLowerCase());

            if (filtered.length > 0) {
                setSuggestions(Array.from(new Set(filtered)).slice(0, 10));
                setSuggestionIndex(0);
                setShowSuggestions(true);

                // Calculate position using explicit line-height (24px)
                const lines = value.slice(0, cursorPos).split("\n");
                const lineCount = lines.length;
                const charCount = lines[lineCount - 1].length;
                setSuggestionPos({
                    top: lineCount * 24 + 16,
                    left: charCount * 8.4 + 16
                });
            } else {
                setShowSuggestions(false);
            }
        } else {
            setShowSuggestions(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.ctrlKey && e.key === "Enter") {
            e.preventDefault();
            onRun(code);
            return;
        }

        if (showSuggestions) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSuggestionIndex(prev => (prev + 1) % suggestions.length);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
            } else if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                applySuggestion(suggestions[suggestionIndex]);
            } else if (e.key === "Escape") {
                setShowSuggestions(false);
            }
        } else {
            if (e.key === "Tab") {
                e.preventDefault();
                const start = e.currentTarget.selectionStart;
                const end = e.currentTarget.selectionEnd;
                const newValue = code.substring(0, start) + "  " + code.substring(end);
                setCode(newValue);
                setTimeout(() => {
                    if (textareaRef.current) {
                        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
                    }
                }, 0);
            }
        }
    };

    const applySuggestion = (suggestion: string) => {
        if (!textareaRef.current) return;
        const cursorPos = textareaRef.current.selectionStart;
        const valueBefore = code.slice(0, cursorPos);
        const lastWordMatch = valueBefore.match(/[\s,()]+$/);
        const lastWordStart = valueBefore.lastIndexOf(valueBefore.split(/[\s,()]+/).pop() || "");

        const newValue = code.slice(0, lastWordStart) + suggestion + code.slice(cursorPos);
        setCode(newValue);
        setShowSuggestions(false);

        setTimeout(() => {
            if (textareaRef.current) {
                const newPos = lastWordStart + suggestion.length;
                textareaRef.current.selectionStart = textareaRef.current.selectionEnd = newPos;
                textareaRef.current.focus();
            }
        }, 0);
    };

    const handleCopy = () => {
        copyToClipboard(code);
    };

    const handleReset = () => {
        setCode("");
    };

    return (
        <div className="flex flex-col h-full bg-background overflow-hidden relative">
            <style dangerouslySetInnerHTML={{ __html: prismStyles }} />

            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2">
                    <div className="flex gap-1.5 mr-4">
                        <div className="w-3 h-3 rounded-full bg-destructive/20 border border-destructive/30" />
                        <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/30" />
                        <div className="w-3 h-3 rounded-full bg-primary/20 border border-primary/30" />
                    </div>
                    <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider font-mono">SQL Editor</span>
                </div>

                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="w-8 h-8 rounded-md hover:bg-muted" onClick={handleReset} title="Clear">
                        <RotateCcw className="w-4 h-4 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" className="w-8 h-8 rounded-md hover:bg-muted" onClick={handleCopy} title="Copy">
                        <Copy className="w-4 h-4 text-muted-foreground" />
                    </Button>
                    <Button
                        variant="default"
                        size="sm"
                        className="h-7 px-3 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ml-2 border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none"
                        onClick={() => onRun(code)}
                    >
                        <Play size={10} className="fill-current" />
                        Run
                        <span className="text-[10px] opacity-50 ml-0.5 hidden sm:inline">Ctrl+↵</span>
                    </Button>
                </div>
            </div>

            {/* Editor Container */}
            <div className="relative flex-1 group overflow-auto bg-background" style={{ scrollbarWidth: 'thin', scrollbarColor: 'hsl(var(--muted-foreground)/.2) transparent' }}>
                <div className="flex min-w-full w-fit min-h-full">
                    {/* Line Numbers */}
                    <div className="sticky left-0 top-0 bottom-0 w-10 bg-background border-r border-border/50 flex flex-col items-center pt-4 pointer-events-none select-none z-20 shrink-0">
                        {code.split("\n").map((_, i) => (
                            <div key={i} className="text-[11px] font-mono text-muted-foreground/40 h-[24px] flex items-center justify-center">
                                {i + 1}
                            </div>
                        ))}
                    </div>

                    {/* Code Editor Layers */}
                    <div className="relative flex-1 grid">
                        <textarea
                            ref={textareaRef}
                            className="col-start-1 row-start-1 w-full h-full bg-transparent text-transparent caret-foreground outline-none z-10 code-editor-textarea resize-none"
                            spellCheck="false"
                            value={code}
                            onChange={handleChange}
                            onKeyDown={handleKeyDown}
                        />
                        <pre
                            ref={preRef}
                            aria-hidden="true"
                            className="col-start-1 row-start-1 m-0 code-editor-pre language-sql"
                            dangerouslySetInnerHTML={{ __html: highlightedCode + "\n" }}
                        />
                    </div>
                </div>

                {/* Suggestion Dropdown */}
                {showSuggestions && (
                    <div
                        className="fixed z-50 bg-popover border border-border rounded-lg shadow-xl min-w-[180px] py-1 animate-in fade-in zoom-in duration-100"
                        style={{
                            top: `${Math.min(suggestionPos.top + (textareaRef.current?.getBoundingClientRect().top || 0), window.innerHeight - 150)}px`,
                            left: `${Math.min(suggestionPos.left + (textareaRef.current?.getBoundingClientRect().left || 0), window.innerWidth - 180)}px`
                        }}
                    >
                        {suggestions.map((suggestion, i) => (
                            <button
                                key={suggestion}
                                className={cn(
                                    "flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs font-medium transition-colors",
                                    i === suggestionIndex ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
                                )}
                                onClick={() => applySuggestion(suggestion)}
                                onMouseEnter={() => setSuggestionIndex(i)}
                            >
                                <div className={cn(
                                    "w-2 h-2 rounded-full",
                                    SQL_KEYWORDS.includes(suggestion) ? "bg-blue-400" : (MOCK_TABLES.includes(suggestion) ? "bg-green-400" : "bg-purple-400")
                                )} />
                                {suggestion}
                                <span className="ml-auto text-[10px] opacity-60">
                                    {SQL_KEYWORDS.includes(suggestion) ? "keyword" : (MOCK_TABLES.includes(suggestion) ? "table" : "column")}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer / Status */}
            <div className="px-4 py-1.5 border-t border-border bg-muted/20 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <span className="text-[10px] text-muted-foreground font-mono">
                        {code.split("\n").length} Lines
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                        {code.length} Chars
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">Ready</span>
                </div>
            </div>
        </div>
    );
}
