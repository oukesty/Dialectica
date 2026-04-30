"use client";

import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";

export function MarkdownContent({ content, className = "" }: { content: string; className?: string }) {
  // Only render as markdown if it looks like markdown (has formatting markers)
  const looksLikeMarkdown = /[*_#`\[\]|>~-]{2,}|```|^\s*[-*+]\s|^\s*\d+\.\s|^\s*#{1,6}\s/m.test(content);

  if (!looksLikeMarkdown) {
    return <p className={`whitespace-pre-wrap ${className}`}>{content}</p>;
  }

  return (
    <div className={`prose-dialect ${className}`}>
      <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
