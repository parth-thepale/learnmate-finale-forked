import React, { useMemo } from 'react';
import katex from 'katex';

interface MathRendererProps {
  content?: string;
  className?: string;
  displayMode?: boolean;
}

/**
 * Tokenizes text containing LaTeX math delimiters into text and math segments:
 * - Block math: $$...$$ or \[...\]
 * - Inline math: $...$ or \(...\)
 */
export function parseMathSegments(text: string): Array<{ type: 'text' | 'inline-math' | 'block-math'; content: string }> {
  if (!text) return [];

  const segments: Array<{ type: 'text' | 'inline-math' | 'block-math'; content: string }> = [];

  // Regex to match block math ($$...$$ or \[...\]) and inline math ($...$ or \(...\))
  // Uses non-greedy matching. Escaped \$ is treated as literal text.
  const regex = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|(?<!\\)\$((?!\$)[\s\S]+?)(?<!\\)\$|\\\([\s\S]+?\\\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const matchStart = match.index;
    const matchStr = match[0];

    // Push preceding text if non-empty
    if (matchStart > lastIndex) {
      segments.push({
        type: 'text',
        content: text.slice(lastIndex, matchStart),
      });
    }

    if (matchStr.startsWith('$$') && matchStr.endsWith('$$')) {
      segments.push({
        type: 'block-math',
        content: matchStr.slice(2, -2).trim(),
      });
    } else if (matchStr.startsWith('\\[') && matchStr.endsWith('\\]')) {
      segments.push({
        type: 'block-math',
        content: matchStr.slice(2, -2).trim(),
      });
    } else if (matchStr.startsWith('\\(') && matchStr.endsWith('\\)')) {
      segments.push({
        type: 'inline-math',
        content: matchStr.slice(2, -2).trim(),
      });
    } else if (matchStr.startsWith('$') && matchStr.endsWith('$')) {
      segments.push({
        type: 'inline-math',
        content: matchStr.slice(1, -1).trim(),
      });
    }

    lastIndex = matchStart + matchStr.length;
  }

  // Push remaining text
  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      content: text.slice(lastIndex),
    });
  }

  return segments;
}

/**
 * Renders LaTeX formula safely via KaTeX with graceful fallback on parse errors.
 */
export function renderKaTeXToString(math: string, displayMode = false): string {
  try {
    return katex.renderToString(math, {
      displayMode,
      throwOnError: false,
      strict: false,
      output: 'htmlAndMathml',
    });
  } catch {
    return `<span class="katex-error" title="Failed to render formula">${escapeHtml(math)}</span>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * React Component for mathematical academic rendering with KaTeX.
 * Prevents horizontal overflow on mobile viewports via responsive scroll wrappers.
 */
export const MathRenderer: React.FC<MathRendererProps> = ({
  content,
  className = '',
  displayMode = false,
}) => {
  const segments = useMemo(() => parseMathSegments(content || ''), [content]);

  if (segments.length === 0) return null;

  return (
    <span className={`lm-math-container ${className}`}>
      {segments.map((seg, idx) => {
        if (seg.type === 'text') {
          // Replace unescaped \$ with literal $ in plain text segments
          const sanitizedText = seg.content.replace(/\\(\$)/g, '$1');
          return <React.Fragment key={idx}>{sanitizedText}</React.Fragment>;
        }

        const isBlock = seg.type === 'block-math' || displayMode;
        const html = renderKaTeXToString(seg.content, isBlock);

        if (isBlock) {
          return (
            <span
              key={idx}
              className="block my-2 overflow-x-auto max-w-full text-center py-1 scrollbar-thin"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        return (
          <span
            key={idx}
            className="inline-block overflow-x-auto max-w-full align-middle mx-0.5"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </span>
  );
};

export default MathRenderer;
