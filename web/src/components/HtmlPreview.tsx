import { htmlDocument } from "../lib/html";
import { cn } from "../lib/utils";

export function HtmlPreview({
  source,
  className,
  title = "HTML preview",
}: {
  source: string;
  className?: string;
  title?: string;
}) {
  return (
    <iframe
      title={title}
      srcDoc={htmlDocument(source)}
      sandbox="allow-scripts allow-forms allow-modals"
      referrerPolicy="no-referrer"
      className={cn("w-full border-0 bg-white", className)}
    />
  );
}
