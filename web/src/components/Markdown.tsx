import {
  Children,
  cloneElement,
  isValidElement,
  memo,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { fileLinkClick } from "../lib/appLink";
import { attachmentNameFromHref, localFileHref } from "../lib/attachments";
import { peroHref, resolveFilePath } from "../lib/diff";
import { executablePath, fileTarget, viewHref } from "../lib/fileLink";
import { markdownBlocks } from "../lib/markdown";
import { splitValues } from "../lib/values";
import { AttachmentPreview, FileTypeIcon } from "./Attachment";
import { CodeBlock } from "./CodeBlock";
import { cn } from "../lib/utils";

const BRACKET = /([()[\]{}])/;

function dimBrackets(text: string): ReactNode {
  return text
    .split(BRACKET)
    .map((part, index) =>
      index % 2 ? (
        <span key={index} className="md-punct">
          {part}
        </span>
      ) : (
        part
      ),
    );
}

function valuesIn(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== "string") return child;
    return splitValues(child).map((part, index) =>
      typeof part === "string" ? (
        part
      ) : (
        <span key={index} className={part.kind === "id" ? "md-id" : "md-value"}>
          {part.text}
        </span>
      ),
    );
  });
}

const NUMERIC_CELL = /^[\s~≈<>+\-–—]*[$€₽]?\d[\d\s.,:/×x–—+-]*\s*[\p{L}%$€₽/]*$/u;
const EMPTY_CELL = /^[\s—–-]*$/;

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

function MarkdownTd({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <td className={className}>{valuesIn(children)}</td>;
}

function MarkdownTh({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <th className={className}>{valuesIn(children)}</th>;
}

function cellsOf(row: ReactNode): ReactElement[] {
  if (!isValidElement(row)) return [];
  if (row.type === MarkdownTd || row.type === MarkdownTh) return [row];
  return Children.toArray((row.props as { children?: ReactNode }).children).flatMap(cellsOf);
}

function bodyRows(children: ReactNode): ReactElement[] {
  const rows: ReactElement[] = [];
  const walk = (node: ReactNode) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isValidElement(node)) return;
    if (node.type === "tr") {
      rows.push(node);
      return;
    }
    if (node.type === "thead") return;
    Children.toArray((node.props as { children?: ReactNode }).children).forEach(walk);
  };
  walk(children);
  return rows;
}

function numericColumns(children: ReactNode): boolean[] {
  const columns: boolean[] = [];
  for (const row of bodyRows(children)) {
    cellsOf(row).forEach((cell, index) => {
      const text = textOf((cell.props as { children?: ReactNode }).children).trim();
      if (!text || EMPTY_CELL.test(text)) return;
      columns[index] = (columns[index] ?? true) && NUMERIC_CELL.test(text);
    });
  }
  return columns;
}

function alignCells(node: ReactNode, columns: boolean[]): ReactNode {
  if (Array.isArray(node)) return node.map((child) => alignCells(child, columns));
  if (!isValidElement(node)) return node;
  const props = node.props as { children?: ReactNode; className?: string };
  if (node.type === "tr") {
    let index = 0;
    const cells = Children.toArray(props.children).map((child) => {
      if (!isValidElement(child)) return child;
      const at = index++;
      if (child.type !== MarkdownTd && child.type !== MarkdownTh) return child;
      if (!columns[at]) return child;
      const cell = child as ReactElement<{ className?: string; children?: ReactNode }>;
      return cloneElement(cell, { className: cn(cell.props.className, "md-num") });
    });
    return cloneElement(node as ReactElement<{ children?: ReactNode }>, { children: cells });
  }
  if (node.type === "thead" || node.type === "tbody" || node.type === "tfoot") {
    return cloneElement(node as ReactElement<{ children?: ReactNode }>, {
      children: alignCells(props.children, columns),
    });
  }
  return node;
}

type CodeProps = {
  node?: { position?: { start: { line: number }; end: { line: number } } };
  className?: string;
  children?: ReactNode;
};

function codeFor(
  streaming: boolean,
  directory?: string | null,
  peroURL?: string | null,
): Components["code"] {
  return function MarkdownCode({ node, className, children }: CodeProps) {
    const text = String(children).replace(/\n$/, "");
    const language = /language-([\w+-]+)/.exec(className ?? "")?.[1];
    const multiline =
      node?.position !== undefined && node.position.start.line !== node.position.end.line;
    if (language || multiline) {
      return <CodeBlock code={text} language={language} streaming={streaming} />;
    }
    const target = fileTarget(text);
    if (target && directory && peroURL) {
      const path = resolveFilePath(target.path, directory);
      const href = viewHref(path);
      const pero = peroHref(peroURL, path, target.lines);
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          title={`View ${target.path} · Shift-click for pero`}
          className="md-file"
          data-file-path={path}
          data-file-lines={target.lines ? JSON.stringify(target.lines) : undefined}
          data-pero-href={pero}
          onClick={fileLinkClick({ app: "pero", path, lines: target.lines }, pero)}
        >
          <FileTypeIcon
            name={target.path}
            executable={executablePath(path)}
            className="mr-1 inline size-[0.95em] align-[-0.12em] opacity-60"
          />
          <code className={className}>{children}</code>
        </a>
      );
    }
    return <code className={className}>{dimBrackets(text)}</code>;
  } as Components["code"];
}

function componentsFor(
  streaming: boolean,
  directory?: string | null,
  peroURL?: string | null,
): Components {
  const components: Components = {
    pre: ({ children }) => <>{children}</>,
    code: codeFor(streaming, directory, peroURL),
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
      const columns = numericColumns(children);
      const aligned = columns.some(Boolean) ? alignCells(children, columns) : children;
      return (
        <div className="scrollbar-thin -mx-1 overflow-x-auto">
          <table>{aligned}</table>
        </div>
      );
    },
    p: ({ children }) => <p>{valuesIn(children)}</p>,
    li: ({ children }) => <li>{valuesIn(children)}</li>,
    td: MarkdownTd,
    th: MarkdownTh,
    img({ src, alt, ...props }) {
      return <img src={src} alt={alt ?? ""} loading="lazy" {...props} />;
    },
  };
  return components;
}

const MarkdownBlock = memo(function MarkdownBlock({
  text,
  streaming,
  directory,
  peroURL,
}: {
  text: string;
  streaming: boolean;
  directory?: string | null;
  peroURL?: string | null;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={componentsFor(streaming, directory, peroURL)}
    >
      {text}
    </ReactMarkdown>
  );
});

export type MarkdownProps = {
  text: string;
  className?: string;
  streaming?: boolean;
  directory?: string | null;
  peroURL?: string | null;
};

export const Markdown = memo(function Markdown({
  text,
  className,
  streaming = false,
  directory,
  peroURL,
}: MarkdownProps) {
  const blocks = markdownBlocks(text);
  return (
    <div className={cn("markdown", className)}>
      {blocks.map((block, index) => (
        <div key={index} className="md-block" data-speech-block={index}>
          <MarkdownBlock
            text={block}
            streaming={streaming && index === blocks.length - 1}
            directory={directory}
            peroURL={peroURL}
          />
        </div>
      ))}
    </div>
  );
});
