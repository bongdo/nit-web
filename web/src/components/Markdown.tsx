import {
  cloneElement,
  createElement,
  Fragment,
  isValidElement,
  memo,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { attachmentNameFromHref, localFileHref } from "../lib/attachments";
import { AttachmentPreview } from "./Attachment";
import { CodeBlock } from "./CodeBlock";
import { cn } from "../lib/utils";

const WORD_STATIC = "data-word-static";

type WordTag =
  | "p"
  | "li"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "td"
  | "th"
  | "blockquote";

function wordBlock(tag: WordTag) {
  return function WordBlock({
    node: _node,
    children,
    ...props
  }: {
    node?: unknown;
    children?: ReactNode;
    [key: string]: unknown;
  }) {
    return createElement(tag, props, <>{words(children)}</>);
  };
}

const wordBlocks = {
  p: wordBlock("p"),
  li: wordBlock("li"),
  h1: wordBlock("h1"),
  h2: wordBlock("h2"),
  h3: wordBlock("h3"),
  h4: wordBlock("h4"),
  h5: wordBlock("h5"),
  h6: wordBlock("h6"),
  td: wordBlock("td"),
  th: wordBlock("th"),
  blockquote: wordBlock("blockquote"),
};

const wordBlockSet = new Set<unknown>(Object.values(wordBlocks));

function words(children: ReactNode): ReactNode {
  if (typeof children === "string") {
    return children
      .split(/(\s+)/)
      .filter(Boolean)
      .map((part, index) =>
        /^\s+$/.test(part) ? (
          part
        ) : (
          <span key={`${index}:${part}`} className="word">
            {part}
          </span>
        ),
      );
  }
  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={index}>{words(child)}</Fragment>
    ));
  }
  if (isValidElement(children)) {
    const props = children.props as { children?: ReactNode; [key: string]: unknown };
    if (props[WORD_STATIC] || wordBlockSet.has(children.type)) return children;
    return cloneElement(children as ReactElement<{ children?: ReactNode }>, {
      children: words(props.children),
    });
  }
  return children;
}

function componentsFor(streaming: boolean): Components {
  const components: Components = {
    pre: ({ children }) => <>{children}</>,
    code({ node, className, children }) {
      const text = String(children).replace(/\n$/, "");
      const language = /language-([\w+-]+)/.exec(className ?? "")?.[1];
      const multiline =
        node?.position !== undefined && node.position.start.line !== node.position.end.line;
      if (language || multiline) {
        return <CodeBlock code={text} language={language} streaming={streaming} />;
      }
      return (
        <code className={className} data-word-static>
          {children}
        </code>
      );
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
  if (streaming) Object.assign(components, wordBlocks);
  return components;
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
