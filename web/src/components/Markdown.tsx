import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { attachmentNameFromHref, localFileHref } from "../lib/attachments";
import { AttachmentPreview } from "./Attachment";
import { CodeBlock } from "./CodeBlock";
import { cn } from "../lib/utils";

function componentsFor(streaming: boolean): Components {
  return {
    pre: ({ children }) => <>{children}</>,
    code({ node, className, children }) {
      const text = String(children).replace(/\n$/, "");
      const language = /language-([\w+-]+)/.exec(className ?? "")?.[1];
      const multiline =
        node?.position !== undefined && node.position.start.line !== node.position.end.line;
      if (language || multiline) {
        return <CodeBlock code={text} language={language} streaming={streaming} />;
      }
      return <code className={className}>{children}</code>;
    },
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
}

const stableComponents = componentsFor(false);
const streamingComponents = componentsFor(true);

export const Markdown = memo(function Markdown({
  text,
  className,
  streaming = false,
}: {
  text: string;
  className?: string;
  streaming?: boolean;
}) {
  return (
    <div className={cn("markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={streaming ? streamingComponents : stableComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
