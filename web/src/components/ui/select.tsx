import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <div className={cn("relative inline-flex min-w-0", className)}>
    <select
      ref={ref}
      className="border-input bg-background hover:bg-accent focus-visible:border-ring focus-visible:ring-ring/30 h-8 w-full cursor-pointer appearance-none truncate rounded-md border pr-7 pl-2.5 text-xs outline-none focus-visible:ring-[3px]"
      {...props}
    >
      {children}
    </select>
    <ChevronDown className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2" />
  </div>
));
Select.displayName = "Select";
