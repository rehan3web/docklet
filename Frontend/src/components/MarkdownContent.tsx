import React from "react";

interface Props {
  content: string;
  className?: string;
}

function classifyLine(text: string): "success" | "error" | "normal" {
  const t = text.toLowerCase();
  if (/^[✓✔]|healthy|success|running|all (checks|ok)|passed|started|ready/.test(t)) return "success";
  if (/^[✗✘×]|error|failed|unhealthy|crash|fatal|denied|refused|cannot|not found/.test(t)) return "error";
  return "normal";
}

function parseInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let i = 0;
  let buf = "";

  const flush = () => { if (buf) { parts.push(buf); buf = ""; } };

  while (i < text.length) {
    // bold **...**
    if (text[i] === "*" && text[i + 1] === "*") {
      flush();
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        parts.push(<strong key={i} className="font-semibold">{text.slice(i + 2, end)}</strong>);
        i = end + 2;
        continue;
      }
    }
    // inline code `...`
    if (text[i] === "`" && text[i + 1] !== "`") {
      flush();
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        parts.push(
          <code key={i} className="font-mono text-[11px] bg-muted/60 border border-border rounded px-1 py-0.5 text-foreground">
            {text.slice(i + 1, end)}
          </code>
        );
        i = end + 1;
        continue;
      }
    }
    buf += text[i++];
  }
  flush();
  return parts;
}

export default function MarkdownContent({ content, className = "" }: Props) {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];

    // Fenced code block ```
    if (raw.trimStart().startsWith("```")) {
      const lang = raw.trimStart().slice(3).trim();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      nodes.push(
        <div key={`cb-${i}`} className="my-2 rounded-lg overflow-hidden border border-border">
          {lang && (
            <div className="px-3 py-1 bg-muted/60 border-b border-border flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">{lang}</span>
            </div>
          )}
          <pre className="bg-[#0d0d0d] p-3 overflow-x-auto">
            <code className="font-mono text-[11px] text-green-400 leading-relaxed whitespace-pre">
              {codeLines.join("\n")}
            </code>
          </pre>
        </div>
      );
      continue;
    }

    // Heading ### / ## / #
    const headingMatch = raw.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const cls = level === 1
        ? "text-sm font-bold mt-3 mb-1"
        : level === 2
        ? "text-xs font-bold mt-2.5 mb-1 uppercase tracking-wide text-muted-foreground"
        : "text-xs font-semibold mt-2 mb-0.5";
      nodes.push(<p key={`h-${i}`} className={cls}>{parseInline(text)}</p>);
      i++;
      continue;
    }

    // Horizontal rule ---
    if (/^-{3,}$/.test(raw.trim())) {
      nodes.push(<hr key={`hr-${i}`} className="border-border my-2" />);
      i++;
      continue;
    }

    // Bullet list item
    const bulletMatch = raw.match(/^(\s*)[*\-+]\s+(.+)/);
    if (bulletMatch) {
      const items: string[] = [];
      while (i < lines.length && /^(\s*)[*\-+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^(\s*)[*\-+]\s+/, ""));
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="space-y-0.5 my-1 pl-3">
          {items.map((item, idx) => (
            <li key={idx} className="flex gap-1.5 text-xs">
              <span className="text-muted-foreground mt-0.5 shrink-0">•</span>
              <span>{parseInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list
    const numMatch = raw.match(/^\d+\.\s+(.+)/);
    if (numMatch) {
      const items: string[] = [];
      let n = 1;
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
        n++;
      }
      nodes.push(
        <ol key={`ol-${i}`} className="space-y-0.5 my-1 pl-4 list-decimal list-outside">
          {items.map((item, idx) => (
            <li key={idx} className="text-xs pl-0.5">{parseInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Empty line → paragraph break
    if (raw.trim() === "") {
      nodes.push(<div key={`br-${i}`} className="h-1.5" />);
      i++;
      continue;
    }

    // Regular paragraph line — color based on content
    const cls = classifyLine(raw);
    const colorCls =
      cls === "success" ? "text-emerald-400 font-medium" :
      cls === "error"   ? "text-red-400 font-medium" :
      "text-foreground/90";

    nodes.push(
      <p key={`p-${i}`} className={`text-xs leading-relaxed ${colorCls}`}>
        {parseInline(raw)}
      </p>
    );
    i++;
  }

  return <div className={`space-y-0.5 ${className}`}>{nodes}</div>;
}
