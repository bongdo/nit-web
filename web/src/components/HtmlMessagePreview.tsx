import { HtmlPreview } from "./HtmlPreview";

export function HtmlMessagePreview({ source }: { source: string }) {
  return <HtmlPreview source={source} autoHeight className="my-3" title="Sandboxed HTML message" />;
}
