import { FileCode2, Terminal } from "lucide-react";
import { peroHref, termHref } from "../lib/diff";
import { cn } from "../lib/utils";
import { buttonVariants } from "./ui/button";

export function WorkspaceLinks({
  directory,
  termURL,
  peroURL,
  className,
}: {
  directory?: string | null;
  termURL: string;
  peroURL: string;
  className?: string;
}) {
  if (!directory) return null;
  const links = [
    { name: "term", href: termHref(termURL, directory), icon: Terminal },
    { name: "pero", href: peroHref(peroURL, directory), icon: FileCode2 },
  ];
  return (
    <div role="group" aria-label="Open workspace in" className={cn("flex items-center", className)}>
      {links.map(({ name, href, icon: Icon }) => (
        <a
          key={name}
          href={href}
          target="_blank"
          rel="noreferrer"
          title={`Open ${directory} in ${name}`}
          aria-label={`Open ${directory} in ${name}`}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "text-muted-foreground hover:text-foreground h-9 px-2",
          )}
        >
          <Icon />
        </a>
      ))}
    </div>
  );
}
