import { useEffect, useRef } from "react";

export function useModalFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return ref;
}
