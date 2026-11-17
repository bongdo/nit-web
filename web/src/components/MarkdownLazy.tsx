import { Suspense, lazy } from "react";
import { cn } from "../lib/utils";
import type { MarkdownProps } from "./Markdown";

const load = () => import("./Markdown");
const MarkdownImpl = lazy(() => load().then((module) => ({ default: module.Markdown })));

export const preloadMarkdown = load;

export function MarkdownLazy(props: MarkdownProps) {
  return (
    <Suspense
      fallback={
        <div className={cn("markdown whitespace-pre-wrap", props.className)}>{props.text}</div>
      }
    >
      <MarkdownImpl {...props} />
    </Suspense>
  );
}
