import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import { cn } from "../lib/utils";

const components: Components = {
  pre: ({ children }) => <>{children}</>,
  code({ node, className, children }) {
    const text = String(children).replace(/\n$/, "");
    const language = /language-([\w+-]+)/.exec(className ?? "")?.[1];
    const multiline =
      node?.position !== undefined && node.position.start.line !== node.position.end.line;
    if (language || multiline) {
      return <CodeBlock code={text} language={language} />;
    }
    return <code className={className}>{children}</code>;
  },
  a({ href, children, ...props }) {
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

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("markdown", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
