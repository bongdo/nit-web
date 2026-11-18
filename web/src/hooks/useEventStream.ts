import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StreamEvent } from "../lib/types";
import { appPath } from "../lib/base";
import { streamDelta } from "../lib/instances";

export type StreamStatus = "connecting" | "online" | "offline";

type Streams = {
  closed: boolean;
  sources: Map<string, EventSource>;
  timers: Map<string, number>;
  seen: Map<string, number>;
  retry: Record<string, number>;
};

const STALE_MS = 55_000;

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
  const streams = useRef<Streams>({
    closed: true,
    sources: new Map(),
    timers: new Map(),
    seen: new Map(),
    retry: {},
  });
  const connected = useRef<string[]>([]);

  const setStatus = useCallback((id: string, status: StreamStatus) => {
    setStatuses((previous) =>
      previous[id] === status ? previous : { ...previous, [id]: status },
    );
  }, []);

  const connect = useCallback(
    (id: string) => {
      const current = streams.current;
      if (current.closed) return;
      setStatus(id, "connecting");
      const source = new EventSource(
        appPath(`/api/events?instance=${encodeURIComponent(id)}`),
      );
      current.sources.set(id, source);
      current.seen.set(id, Date.now());
      source.onopen = () => {
        current.retry[id] = 0;
        current.seen.set(id, Date.now());
        setStatus(id, "online");
        openRef.current?.(id);
      };
      source.onmessage = (message) => {
        current.seen.set(id, Date.now());
        try {
          const parsed = JSON.parse(message.data) as StreamEvent;
          if (parsed && typeof parsed.type === "string" && parsed.type !== "ping") {
            eventRef.current(parsed, id);
          }
        } catch {
          return;
        }
      };
      source.onerror = () => {
        if (current.sources.get(id) !== source) return;
        setStatus(id, "offline");
        source.close();
        current.sources.delete(id);
        current.seen.delete(id);
        const attempt = current.retry[id] ?? 0;
        current.retry[id] = attempt + 1;
        const base = 500 * 2 ** attempt;
        const delay = Math.min(8_000, Math.round(base * (0.7 + Math.random() * 0.6)));
        const timer = window.setTimeout(() => {
          current.timers.delete(id);
          connect(id);
        }, delay);
        current.timers.set(id, timer);
      };
    },
    [setStatus],
  );

  useEffect(() => {
    const current = streams.current;
    current.closed = false;
    const next = key ? key.split("|") : [];
    const { open, close } = streamDelta(connected.current, next);
    for (const id of close) {
      const source = current.sources.get(id);
      if (source) {
        source.close();
        current.sources.delete(id);
      }
      const timer = current.timers.get(id);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        current.timers.delete(id);
      }
      current.seen.delete(id);
      delete current.retry[id];
    }
    for (const id of open) connect(id);
    if (close.length > 0) {
      setStatuses((previous) => {
        const copy = { ...previous };
        for (const id of close) delete copy[id];
        return copy;
      });
    }
    connected.current = next;
  }, [key, connect]);

  useEffect(() => {
    const check = () => {
      const current = streams.current;
      if (current.closed || document.hidden) return;
      const now = Date.now();
      for (const [id, source] of current.sources) {
        if (now - (current.seen.get(id) ?? 0) <= STALE_MS) continue;
        source.close();
        current.sources.delete(id);
        current.seen.delete(id);
        connect(id);
      }
    };
    const timer = window.setInterval(check, 10_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [connect]);

  useEffect(() => {
    return () => {
      const current = streams.current;
      current.closed = true;
      for (const timer of current.timers.values()) window.clearTimeout(timer);
      current.timers.clear();
      for (const source of current.sources.values()) source.close();
      current.sources.clear();
      connected.current = [];
    };
  }, []);

  return statuses;
}
