import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Crop, Loader2, RotateCcw } from "lucide-react";
import { cropBox, cropFile, cropReady, type CropBox } from "../lib/crop";
import { Button } from "./ui/button";
import { Modal } from "./ui/Modal";

const STEP = 0.02;

function moved(box: CropBox, dx: number, dy: number): CropBox {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const left = Math.min(1 - width, Math.max(0, box.left + dx));
  const top = Math.min(1 - height, Math.max(0, box.top + dy));
  return { left, top, right: left + width, bottom: top + height };
}

export function ImageCrop({
  src,
  name,
  file,
  onApply,
  onClose,
}: {
  src: string;
  name: string;
  file: File;
  onApply: (file: File) => void;
  onClose: () => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<CropBox | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  };

  const apply = async () => {
    if (!cropReady(box) || busy) return;
    setBusy(true);
    setError(null);
    try {
      onApply(await cropFile(file, box));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not crop the image.");
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dx =
        event.key === "ArrowLeft" ? -STEP : event.key === "ArrowRight" ? STEP : 0;
      const dy = event.key === "ArrowUp" ? -STEP : event.key === "ArrowDown" ? STEP : 0;
      if (!dx && !dy) return;
      event.preventDefault();
      setBox((current) => {
        const base = current ?? { left: 0.05, top: 0.05, right: 0.95, bottom: 0.95 };
        if (!event.shiftKey) return moved(base, dx, dy);
        return cropBox(
          { x: base.left, y: base.top },
          { x: base.right + dx, y: base.bottom + dy },
        );
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <Modal
      label={`Crop ${name}`}
      closeLabel="Close crop"
      title={<h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Crop {name}</h2>}
      onClose={onClose}
      panelClassName="max-w-2xl"
    >
        <div className="scrollbar-thin flex min-h-0 flex-1 justify-center overflow-auto p-3">
          <div
            ref={frame}
            className="relative h-fit w-fit cursor-crosshair touch-none overflow-hidden select-none"
            onPointerDown={(event) => {
              const at = point(event);
              if (!at) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              anchor.current = at;
              setBox(cropBox(at, at));
            }}
            onPointerMove={(event) => {
              if (!anchor.current) return;
              const at = point(event);
              if (at) setBox(cropBox(anchor.current, at));
            }}
            onPointerUp={(event) => {
              if (!anchor.current) return;
              anchor.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              setBox((current) => (cropReady(current) ? current : null));
            }}
          >
            <img
              src={src}
              alt={name}
              draggable={false}
              className="block max-h-[60dvh] max-w-full object-contain"
            />
            {box && (
              <div
                className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                style={{
                  left: `${box.left * 100}%`,
                  top: `${box.top * 100}%`,
                  width: `${(box.right - box.left) * 100}%`,
                  height: `${(box.bottom - box.top) * 100}%`,
                }}
              />
            )}
          </div>
        </div>

        {error && <p className="text-destructive px-4 pb-2 text-[11px]">{error}</p>}

        <div className="border-border flex items-center gap-2 border-t px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setBox(null)}
            disabled={!box || busy}
          >
            <RotateCcw />
            Reset
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void apply()} disabled={!cropReady(box) || busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Crop />}
              Crop
            </Button>
          </div>
        </div>
    </Modal>
  );
}
