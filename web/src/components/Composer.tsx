import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { Session } from "../lib/types";
import { formatCost, formatTokens } from "../lib/format";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export function Composer({
  session,
  disabled,
  running,
  modelName,
  focusKey,
  onSend,
  onStop,
}: {
  session: Session | null;
  disabled?: boolean;
  running?: boolean;
  modelName?: string;
  focusKey?: string | null;
  onSend: (text: string) => Promise<void>;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusKey) ref.current?.focus();
  }, [focusKey]);

  useEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.style.height = "0px";
    area.style.height = `${Math.min(area.scrollHeight, 200)}px`;
  }, [value]);

  const submit = async () => {
    const text = value.trim();
    if (!text || !session || disabled || running || submitting) return;
    setSubmitting(true);
    setValue("");
    try {
      await onSend(text);
    } catch {
      setValue(text);
    } finally {
      setSubmitting(false);
    }
  };

  const tokens = session?.tokens;

  return (
    <div className="border-border bg-background/95 supports-[backdrop-filter]:bg-background/80 shrink-0 border-t backdrop-blur">
      <div className="mx-auto w-full max-w-3xl px-4 pt-3 pb-2">
        <div
          className={cn(
            "border-border bg-card focus-within:border-ring focus-within:ring-ring/20 rounded-xl border shadow-sm transition-shadow focus-within:ring-[3px]",
            disabled && "opacity-60",
          )}
        >
          <Textarea
            ref={ref}
            rows={1}
            value={value}
            disabled={disabled || !session}
            aria-label="Message"
            placeholder={
              session ? "Ask anything…" : "Select or create a session to start"
            }
            className="scrollbar-thin max-h-[200px] min-h-[44px] px-4 py-3 text-[15px]"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="flex items-center gap-2 px-2.5 pb-2">
            <span className="text-muted-foreground hidden text-[11px] sm:inline">
              Enter to send · Shift+Enter for a new line
            </span>
            <div className="ml-auto">
              {running ? (
                <Button variant="secondary" size="sm" onClick={onStop} aria-label="Stop">
                  <Square className="fill-current" />
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => void submit()}
                  disabled={!session || disabled || !value.trim() || submitting}
                  aria-label="Send"
                >
                  <ArrowUp />
                  Send
                </Button>
              )}
            </div>
          </div>
        </div>
        {session && (
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pt-2 text-[11px]">
            {modelName && <span className="truncate">{modelName}</span>}
            {tokens && (
              <span className="ml-auto">
                {formatTokens(tokens.input)} in · {formatTokens(tokens.output)} out
              </span>
            )}
            <span className={tokens ? "" : "ml-auto"}>{formatCost(session.cost)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
