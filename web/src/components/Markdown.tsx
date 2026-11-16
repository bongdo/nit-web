import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { attachmentNameFromHref, localFileHref } from "../lib/attachments";
import { splitMarkdownBlocks } from "../lib/markdown";
import { AttachmentPreview } from "./Attachment";
import { CodeBlock } from "./CodeBlock";
import { cn } from "../lib/utils";

type CodeProps = {
  node?: { position?: { start: { line: number }; end: { line: number } } };
  className?: string;
  children?: ReactNode;
};

function codeFor(streaming: boolean): Components["code"] {
  return function MarkdownCode({ node, className, children }: CodeProps) {
    const text = String(children).replace(/\n$/, "");
    const language = /language-([\w+-]+)/.exec(className ?? "")?.[1];
    const multiline =
      node?.position !== undefined && node.position.start.line !== node.position.end.line;
    if (language || multiline) {
      return <CodeBlock code={text} language={language} streaming={streaming} />;
    }
    return <code className={className}>{children}</code>;
  } as Components["code"];
}

const stableCode = codeFor(false);
const streamingCode = codeFor(true);

function componentsFor(streaming: boolean): Components {
  const components: Components = {
    pre: ({ children }) => <>{children}</>,
    code: streaming ? streamingCode : stableCode,
    a({ href, children, ...props }) {
      const localHref = localFileHref(href);
      if (localHref) {
        const text = typeof children === "string" ? children.trim() : "";
        const name = /\.[a-z0-9]+$/i.test(text) ? text : attachmentNameFromHref(localHref);
        return <AttachmentPreview name={name} href={localHref} />;
      }
      const external = Boolean(href && /^https?:\/\//i.test(href));
      return (
        <a
          href={href}
          target={external ? "_blank" : undefined}
          rel={external ? "noreferrer noopener" : undefined}
          {...props}
        >
          {children}
        </a>
      );
    },
    table({ children }) {
      return (
        <div className="scrollbar-thin -mx-1 overflow-x-auto">
          <table>{children}</table>
        </div>
      );
    },
    img({ src, alt, ...props }) {
      return <img src={src} alt={alt ?? ""} loading="lazy" {...props} />;
    },
  };
  return components;
}

const stableComponents = componentsFor(false);
const streamingComponents = componentsFor(true);

const MarkdownBlock = memo(function MarkdownBlock({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={streaming ? streamingComponents : stableComponents}
    >
      {text}
    </ReactMarkdown>
  );
});

export const Markdown = memo(function Markdown({
  text,
  className,
  streaming = false,
}: {
  text: string;
  className?: string;
  streaming?: boolean;
}) {
  const blocks = streaming ? splitMarkdownBlocks(text) : null;
  return (
    <div className={cn("markdown", className)}>
      {blocks ? (
        blocks.map((block, index) => (
          <MarkdownBlock
            key={index}
            text={block}
            streaming={index === blocks.length - 1}
          />
        ))
      ) : (
        <MarkdownBlock text={text} streaming={streaming} />
      )}
    </div>
  );
});
