import { useEffect, useMemo, useRef, useState } from "react";
import type { StreamEvent } from "../lib/types";
import { appPath } from "../lib/base";

export type StreamStatus = "connecting" | "online" | "offline";

export function useEventStream(
  onEvent: (event: StreamEvent, instance: string) => void,
  onOpen: ((instance: string) => void) | undefined,
  instances: string[],
): Record<string, StreamStatus> {
  const [statuses, setStatuses] = useState<Record<string, StreamStatus>>({});
  const eventRef = useRef(onEvent);
  const openRef = useRef(onOpen);
  eventRef.current = onEvent;
  openRef.current = onOpen;
  const key = useMemo(
    () => [...new Set(instances.filter(Boolean))].sort().join("|"),
    [instances],
  );

  useEffect(() => {
    const ids = key ? key.split("|") : [];
    const sources = new Map<string, EventSource>();
    const timers = new Map<string, number>();
    const retry: Record<string, number> = {};
    let closed = false;

    const setStatus = (id: string, status: StreamStatus) =>
      setStatuses((previous) =>
        previous[id] === status ? previous : { ...previous, [id]: status },
      );

    const connect = (id: string) => {
      if (closed) return;
      setStatus(id, "connecting");
      const source = new EventSource(
        appPath(`/api/events?instance=${encodeURIComponent(id)}`),
      );
      sources.set(id, source);
      source.onopen = () => {
        retry[id] = 0;
        setStatus(id, "online");
        openRef.current?.(id);
      };
      source.onmessage = (message) => {
        try {
          const parsed = JSON.parse(message.data) as StreamEvent;
          if (parsed && typeof parsed.type === "string") eventRef.current(parsed, id);
        } catch {
          return;
        }
      };
      source.onerror = () => {
        if (sources.get(id) !== source) return;
        setStatus(id, "offline");
        source.close();
        sources.delete(id);
        const attempt = retry[id] ?? 0;
        retry[id] = attempt + 1;
        const base = 500 * 2 ** attempt;
        const delay = Math.min(8_000, Math.round(base * (0.7 + Math.random() * 0.6)));
        const timer = window.setTimeout(() => {
          timers.delete(id);
          connect(id);
        }, delay);
        timers.set(id, timer);
      };
    };

    for (const id of ids) connect(id);
    return () => {
      closed = true;
      for (const timer of timers.values()) window.clearTimeout(timer);
      for (const source of sources.values()) source.close();
    };
  }, [key]);

  return statuses;
}
