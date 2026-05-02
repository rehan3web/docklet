import React, { useState, useRef, useCallback } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-sql";
import {
  Play, Copy, RotateCcw, Sparkles, Send, Loader2,
  CheckCircle, AlertTriangle, ShieldAlert, X, ArrowDownToLine,
  ChevronDown, ChevronUp, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, copyToClipboard } from "@/lib/utils";
import { aiGenerateSql, useGetAiSettings } from "@/api/client";
import { toast } from "sonner";

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
    overflow: hidden !important;
  }
  .code-editor-pre {
    color: hsl(var(--foreground));
    margin: 0;
    pointer-events: none;
    border: none;
    background: transparent !important;
  }
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
  "AS", "DISTINCT", "COUNT", "SUM", "AVG", "MIN", "MAX", "TABLE", "INTO", "VALUES", "SET",
];

const MOCK_TABLES = ["users", "profiles", "orders", "products", "transactions", "audit_logs"];
const MOCK_COLUMNS: Record<string, string[]> = {
  users: ["id", "email", "full_name", "created_at", "updated_at"],
  profiles: ["id", "user_id", "avatar_url", "bio"],
  orders: ["id", "user_id", "total_amount", "status", "created_at"],
  products: ["id", "name", "price", "stock_quantity", "category"],
};

const AI_PROMPTS = [
  "Show all tables in this database",
  "Count rows per table",
  "Find the 10 most recent records",
  "Show table sizes",
  "List all indexes",
  "Find duplicate rows",
];

type AiResult = {
  query: string;
  explanation: string;
  readOnly: boolean;
  operationType: string;
  warning: string | null;
};

interface SqlCodeEditorProps {
  onRun: (code: string) => void;
  initialValue?: string;
  value?: string;
  onChange?: (value: string) => void;
}

export function SqlCodeEditor({
  onRun,
  initialValue = "",
  value: controlledValue,
  onChange: controlledOnChange,
}: SqlCodeEditorProps) {
  const [internalCode, setInternalCode] = useState(initialValue || "");
  const code = controlledValue !== undefined ? controlledValue : internalCode;
  const setCode = (v: string) => {
    if (controlledOnChange) controlledOnChange(v);
    else setInternalCode(v);
  };

  const [suggestions, setSuggestions]       = useState<string[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [suggestionPos, setSuggestionPos]   = useState({ top: 0, left: 0 });
  const [showSuggestions, setShowSuggestions] = useState(false);

  // AI bar
  const [showAiBar, setShowAiBar]   = useState(false);
  const [aiPrompt, setAiPrompt]     = useState("");
  const [aiLoading, setAiLoading]   = useState(false);
  const [aiResult, setAiResult]     = useState<AiResult | null>(null);
  const [confirmRun, setConfirmRun] = useState(false);

  const { data: aiSettings } = useGetAiSettings();
  const aiConfigured = aiSettings?.configured ?? false;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef      = useRef<HTMLPreElement>(null);

  const highlightedCode = React.useMemo(
    () => Prism.highlight(code || " ", Prism.languages.sql, "sql"),
    [code]
  );
  const highlightedAiQuery = React.useMemo(
    () => (aiResult?.query ? Prism.highlight(aiResult.query, Prism.languages.sql, "sql") : ""),
    [aiResult?.query]
  );

  // ── Editor handlers ────────────────────────────────────────────────────────

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setCode(val);
    const cursorPos = e.target.selectionStart;
    const lastWord  = val.slice(0, cursorPos).split(/[\s,()]+/).pop() || "";
    if (lastWord.length > 1) {
      const filtered = [
        ...SQL_KEYWORDS,
        ...MOCK_TABLES,
        ...Object.values(MOCK_COLUMNS).flat(),
      ].filter(k => k.toLowerCase().startsWith(lastWord.toLowerCase()) && k.toLowerCase() !== lastWord.toLowerCase());
      if (filtered.length > 0) {
        setSuggestions(Array.from(new Set(filtered)).slice(0, 10));
        setSuggestionIndex(0);
        setShowSuggestions(true);
        const lines = val.slice(0, cursorPos).split("\n");
        setSuggestionPos({ top: lines.length * 24 + 16, left: lines[lines.length - 1].length * 8.4 + 16 });
      } else { setShowSuggestions(false); }
    } else { setShowSuggestions(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); onRun(code); return; }
    if (showSuggestions) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSuggestionIndex(p => (p + 1) % suggestions.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSuggestionIndex(p => (p - 1 + suggestions.length) % suggestions.length); }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); applySuggestion(suggestions[suggestionIndex]); }
      else if (e.key === "Escape") { setShowSuggestions(false); }
    } else if (e.key === "Tab") {
      e.preventDefault();
      const s = e.currentTarget.selectionStart, en = e.currentTarget.selectionEnd;
      const nv = code.substring(0, s) + "  " + code.substring(en);
      setCode(nv);
      setTimeout(() => { if (textareaRef.current) textareaRef.current.selectionStart = textareaRef.current.selectionEnd = s + 2; }, 0);
    }
  };

  const applySuggestion = (suggestion: string) => {
    if (!textareaRef.current) return;
    const cur = textareaRef.current.selectionStart;
    const before = code.slice(0, cur);
    const start = before.lastIndexOf(before.split(/[\s,()]+/).pop() || "");
    setCode(code.slice(0, start) + suggestion + code.slice(cur));
    setShowSuggestions(false);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + suggestion.length;
        textareaRef.current.focus();
      }
    }, 0);
  };

  // ── AI handlers ────────────────────────────────────────────────────────────

  const handleAiGenerate = useCallback(async (prompt?: string) => {
    const p = (prompt ?? aiPrompt).trim();
    if (!p) return;
    if (!aiConfigured) { toast.error("Set up your AI API key on the AI page first."); return; }
    setAiLoading(true);
    setAiResult(null);
    setConfirmRun(false);
    try {
      const result = await aiGenerateSql(p);
      setAiResult(result);
    } catch (err: any) {
      toast.error(err.message || "AI query generation failed");
    } finally {
      setAiLoading(false);
    }
  }, [aiPrompt, aiConfigured]);

  const handleInsertToEditor = () => {
    if (!aiResult) return;
    setCode(aiResult.query);
    setAiResult(null);
    setAiPrompt("");
    setConfirmRun(false);
    toast.success("Query inserted into editor");
  };

  const handleAiRun = () => {
    if (!aiResult) return;
    if (!aiResult.readOnly && !confirmRun) { setConfirmRun(true); return; }
    onRun(aiResult.query);
    setCode(aiResult.query);
    setAiResult(null);
    setAiPrompt("");
    setConfirmRun(false);
  };

  // Badge for operation type — uses app border/muted tokens, only destructive uses red
  const opBadge = aiResult ? (() => {
    const op = aiResult.operationType?.toUpperCase() || "";
    if (aiResult.readOnly)
      return { label: op || "SELECT", cls: "bg-primary/10 text-primary border-primary/20" };
    if (["DROP", "TRUNCATE", "DELETE"].includes(op))
      return { label: op, cls: "bg-destructive/10 text-destructive border-destructive/20" };
    return { label: op || "WRITE", cls: "bg-muted text-foreground border-border" };
  })() : null;

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden relative">
      <style dangerouslySetInnerHTML={{ __html: prismStyles }} />

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 mr-4">
            <div className="w-3 h-3 rounded-full bg-destructive/20 border border-destructive/30" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/30" />
            <div className="w-3 h-3 rounded-full bg-primary/20 border border-primary/30" />
          </div>
          <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider font-mono">SQL Editor</span>
        </div>

        <div className="flex items-center gap-2">
          {/* AI Generate toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setShowAiBar(v => !v); setAiResult(null); setConfirmRun(false); }}
            className={cn(
              "h-7 px-2.5 text-xs gap-1.5 rounded-md transition-all",
              showAiBar
                ? "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">AI Generate</span>
            {showAiBar ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
          <div className="w-px h-5 bg-border" />
          <Button variant="ghost" size="icon" className="w-8 h-8 rounded-md hover:bg-muted" onClick={() => setCode("")} title="Clear">
            <RotateCcw className="w-4 h-4 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon" className="w-8 h-8 rounded-md hover:bg-muted" onClick={() => copyToClipboard(code)} title="Copy">
            <Copy className="w-4 h-4 text-muted-foreground" />
          </Button>
          <Button
            size="sm"
            className="h-7 px-3 rounded-md text-xs font-medium flex items-center gap-1.5 ml-1 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none border border-black/10 dark:border-white/10"
            onClick={() => onRun(code)}
          >
            <Play size={10} className="fill-current" />
            Run
            <span className="text-[10px] opacity-50 ml-0.5 hidden sm:inline">Ctrl+↵</span>
          </Button>
        </div>
      </div>

      {/* ── AI Bar ──────────────────────────────────────────────────────────── */}
      {showAiBar && (
        <div className="border-b border-border bg-muted/20 shrink-0">
          {/* Input row */}
          <div className="flex items-center gap-2 px-4 py-2.5">
            <Sparkles className="w-4 h-4 text-primary shrink-0" />
            <input
              className="flex-1 bg-background border border-border rounded-md px-3 h-8 text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/50"
              placeholder={
                aiConfigured
                  ? 'Describe what you need — e.g. "Show all users created this month"'
                  : "Configure your AI API key on the AI page first"
              }
              value={aiPrompt}
              onChange={e => { setAiPrompt(e.target.value); setAiResult(null); setConfirmRun(false); }}
              onKeyDown={e => { if (e.key === "Enter") handleAiGenerate(); }}
              disabled={!aiConfigured || aiLoading}
              autoComplete="off"
            />
            <Button
              size="sm"
              variant="default"
              className="h-8 px-3 text-xs gap-1.5 shrink-0"
              onClick={() => handleAiGenerate()}
              disabled={!aiConfigured || !aiPrompt.trim() || aiLoading}
            >
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {aiLoading ? "Generating…" : "Generate"}
            </Button>
          </div>

          {/* Quick prompts */}
          {!aiResult && !aiLoading && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2.5">
              {AI_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => { setAiPrompt(p); handleAiGenerate(p); }}
                  disabled={!aiConfigured || aiLoading}
                  className="text-[11px] bg-background hover:bg-muted border border-border px-2 py-1 rounded-md text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {/* Thinking indicator */}
          {aiLoading && (
            <div className="flex items-center gap-2 px-4 pb-3 text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="text-xs">Generating query…</span>
            </div>
          )}

          {/* Result panel */}
          {aiResult && !aiLoading && (
            <div className="mx-4 mb-3 rounded-lg border border-border bg-background overflow-hidden">
              {/* Header row */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
                <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex-1">Generated Query</span>
                {opBadge && (
                  <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", opBadge.cls)}>
                    {opBadge.label}
                  </span>
                )}
                <button
                  className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                  onClick={() => { setAiResult(null); setConfirmRun(false); }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Query preview */}
              <div className="bg-muted/10 overflow-auto max-h-40" style={{ scrollbarWidth: "thin" }}>
                <pre
                  className="language-sql px-4 py-3 text-sm font-mono leading-relaxed whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: highlightedAiQuery }}
                />
              </div>

              {/* Explanation */}
              {aiResult.explanation && (
                <div className="flex items-start gap-2 px-3 py-2 border-t border-border bg-muted/10">
                  <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">{aiResult.explanation}</p>
                </div>
              )}

              {/* Warning strip for write/destructive */}
              {(!aiResult.readOnly || aiResult.warning) && (
                <div className={cn(
                  "flex items-start gap-2 px-3 py-2 border-t text-xs",
                  ["DROP", "TRUNCATE", "DELETE"].includes(aiResult.operationType?.toUpperCase())
                    ? "border-destructive/20 bg-destructive/5 text-destructive"
                    : "border-border bg-muted/20 text-muted-foreground"
                )}>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <p>{aiResult.warning || "This query will modify your database. Review it carefully before running."}</p>
                </div>
              )}

              {/* Confirm step for destructive queries */}
              {!aiResult.readOnly && confirmRun && (
                <div className="flex items-center gap-2 px-3 py-2 border-t border-destructive/20 bg-destructive/5">
                  <ShieldAlert className="w-3.5 h-3.5 text-destructive shrink-0" />
                  <p className="text-xs text-destructive flex-1 font-medium">This cannot be undone. Are you sure?</p>
                  <Button size="sm" variant="destructive" className="h-7 px-3 text-xs gap-1" onClick={handleAiRun}>
                    <Play className="w-3 h-3 fill-current" /> Confirm & Run
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 px-3 text-xs" onClick={() => setConfirmRun(false)}>
                    Cancel
                  </Button>
                </div>
              )}

              {/* Action buttons */}
              {!(confirmRun && !aiResult.readOnly) && (
                <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-muted/10">
                  <Button variant="outline" size="sm" className="h-7 px-3 text-xs gap-1.5" onClick={handleInsertToEditor}>
                    <ArrowDownToLine className="w-3 h-3" /> Insert into Editor
                  </Button>
                  {aiResult.readOnly ? (
                    <Button size="sm" className="h-7 px-3 text-xs gap-1.5 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none" onClick={handleAiRun}>
                      <Play className="w-3 h-3 fill-current" /> Run Query
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 px-3 text-xs gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/5" onClick={handleAiRun}>
                      <Play className="w-3 h-3 fill-current" /> Run (Write)
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Editor Container ─────────────────────────────────────────────────── */}
      <div
        className="relative flex-1 group overflow-auto bg-background"
        style={{ scrollbarWidth: "thin", scrollbarColor: "hsl(var(--muted-foreground)/.2) transparent" }}
      >
        <div className="flex min-w-full w-fit min-h-full">
          {/* Line numbers */}
          <div className="sticky left-0 top-0 bottom-0 w-10 bg-background border-r border-border/50 flex flex-col items-center pt-4 pointer-events-none select-none z-20 shrink-0">
            {code.split("\n").map((_, i) => (
              <div key={i} className="text-[11px] font-mono text-muted-foreground/40 h-[24px] flex items-center justify-center">
                {i + 1}
              </div>
            ))}
          </div>

          {/* Editor layers */}
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

        {/* Autocomplete suggestions */}
        {showSuggestions && (
          <div
            className="fixed z-50 bg-popover border border-border rounded-lg shadow-xl min-w-[180px] py-1 animate-in fade-in zoom-in duration-100"
            style={{
              top:  `${Math.min(suggestionPos.top  + (textareaRef.current?.getBoundingClientRect().top  || 0), window.innerHeight - 150)}px`,
              left: `${Math.min(suggestionPos.left + (textareaRef.current?.getBoundingClientRect().left || 0), window.innerWidth  - 180)}px`,
            }}
          >
            {suggestions.map((s, i) => (
              <button
                key={s}
                className={cn(
                  "flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs font-medium transition-colors",
                  i === suggestionIndex ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
                )}
                onClick={() => applySuggestion(s)}
                onMouseEnter={() => setSuggestionIndex(i)}
              >
                <div className={cn("w-2 h-2 rounded-full",
                  SQL_KEYWORDS.includes(s) ? "bg-blue-400" : MOCK_TABLES.includes(s) ? "bg-green-400" : "bg-purple-400"
                )} />
                {s}
                <span className="ml-auto text-[10px] opacity-60">
                  {SQL_KEYWORDS.includes(s) ? "keyword" : MOCK_TABLES.includes(s) ? "table" : "column"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div className="px-4 py-1.5 border-t border-border bg-muted/20 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-[10px] text-muted-foreground font-mono">{code.split("\n").length} Lines</span>
          <span className="text-[10px] text-muted-foreground font-mono">{code.length} Chars</span>
        </div>
        <div className="flex items-center gap-2">
          {showAiBar && aiConfigured && (
            <>
              <Sparkles className="w-2.5 h-2.5 text-primary" />
              <span className="text-[10px] text-primary font-medium">AI Ready</span>
              <div className="w-px h-3 bg-border" />
            </>
          )}
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">Ready</span>
        </div>
      </div>
    </div>
  );
}
