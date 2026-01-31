import type { ReactNode } from "react";

const INLINE_REGEX = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

type KeyFactory = () => string;

function stripLanguageHint(block: string): string {
  const lines = block.replace(/\r\n/g, "\n").split("\n");
  if (lines.length <= 1) return block.trimEnd();
  const first = lines[0].trim();
  if (first && /^[a-zA-Z0-9_-]+$/.test(first)) {
    return lines.slice(1).join("\n").trimEnd();
  }
  return block.trimEnd();
}

function parseInline(text: string, nextKey: KeyFactory): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_REGEX.lastIndex = 0;

  while ((match = INLINE_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      nodes.push(<code key={nextKey()}>{match[1]}</code>);
    } else if (match[2]) {
      nodes.push(<strong key={nextKey()}>{match[2]}</strong>);
    } else if (match[3]) {
      nodes.push(<em key={nextKey()}>{match[3]}</em>);
    } else if (match[4] && match[5]) {
      nodes.push(
        <a key={nextKey()} href={match[5]} target="_blank" rel="noreferrer">
          {match[4]}
        </a>
      );
    }
    lastIndex = INLINE_REGEX.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

export function renderMarkdown(content: string): ReactNode[] {
  if (!content) return [];
  const nodes: ReactNode[] = [];
  let keyIndex = 0;
  const nextKey = () => `md-${keyIndex++}`;
  const blocks = content.split("```");

  blocks.forEach((block, blockIndex) => {
    if (blockIndex % 2 === 1) {
      nodes.push(
        <pre key={nextKey()} className="md-block">
          <code>{stripLanguageHint(block)}</code>
        </pre>
      );
      return;
    }

    const lines = block.replace(/\r\n/g, "\n").split("\n");
    lines.forEach((line, lineIndex) => {
      nodes.push(...parseInline(line, nextKey));
      if (lineIndex < lines.length - 1) {
        nodes.push(<br key={nextKey()} />);
      }
    });
  });

  return nodes;
}
