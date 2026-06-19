// Tiny zero-dependency markdown renderer for the limited subset our AI profiles
// emit: ### headings, - bullets, > blockquotes, **bold**, and paragraphs.
import React from "react";

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>;
  });
}

export function Markdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length) {
      const items = [...list];
      blocks.push(
        <ul key={`ul-${key++}`} className="my-2 list-disc space-y-1 pl-5">
          {items.map((item, i) => (
            <li key={i}>{renderInline(item, `li-${key}-${i}`)}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushList();
      continue;
    }
    if (line.startsWith("### ")) {
      flushList();
      blocks.push(
        <h3
          key={`h-${key++}`}
          className="mt-4 mb-1 text-sm font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400"
        >
          {line.slice(4)}
        </h3>
      );
    } else if (line.startsWith("> ")) {
      flushList();
      blocks.push(
        <blockquote
          key={`bq-${key++}`}
          className="my-2 border-l-2 border-zinc-300 dark:border-zinc-700 pl-3 text-sm italic text-zinc-500 dark:text-zinc-400"
        >
          {renderInline(line.slice(2), `bq-${key}`)}
        </blockquote>
      );
    } else if (/^[-*]\s+/.test(line)) {
      list.push(line.replace(/^[-*]\s+/, ""));
    } else {
      flushList();
      blocks.push(
        <p key={`p-${key++}`} className="my-2 text-sm leading-relaxed">
          {renderInline(line, `p-${key}`)}
        </p>
      );
    }
  }
  flushList();

  return <div className="text-zinc-700 dark:text-zinc-200">{blocks}</div>;
}
