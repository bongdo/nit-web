import { useEffect, useRef, useState } from "react";
import type { StreamEvent } from "../lib/types";
import { appPath } from "../lib/base";

export type StreamStatus = "connecting" | "online" | "offline";

export function useEventStream(
  onEvent: (event: StreamEvent) => void,
  onOpen?: () => void,
) {
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const eventRef = useRef(onEvent);
  const openRef = useRef(onOpen);
  eventRef.current = onEvent;
  openRef.current = onOpen;

  useEffect(() => {
    let source: EventSource | null = null;
    let closed = false;
    let retry = 0;

    const connect = () => {
      if (closed) return;
      setStatus("connecting");
      source = new EventSource(appPath("/api/events"));
      source.onopen = () => {
        retry = 0;
        setStatus("online");
        openRef.current?.();
      };
      source.onmessage = (message) => {
        try {
          const parsed = JSON.parse(message.data) as StreamEvent;
          if (parsed && typeof parsed.type === "string") eventRef.current(parsed);
        } catch {
          return;
        }
      };
      source.onerror = () => {
        setStatus("offline");
        if (source?.readyState === EventSource.CLOSED) {
          source.close();
          source = null;
          const delay = Math.min(8_000, 500 * 2 ** retry++);
          window.setTimeout(connect, delay);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      source?.close();
    };
  }, []);

  return status;
}
