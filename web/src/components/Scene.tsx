import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";

const GAP = 24;
const STEP = 5;
const STILL_TIME = 6;
const CURSOR_RADIUS = 150;

export function Scene({
  motion = "animated",
  className,
}: {
  motion?: "animated" | "static";
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const still = motion === "static";
    const reduced =
      still || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointer = { x: -9999, y: -9999 };
    const cursor = { x: 0, y: 0, power: 0 };
    let width = 0;
    let height = 0;
    let frame = 0;
    let started = performance.now();
    let painted = 0;
    let paletteAt = 0;
    let staticPainted = 0;
    let ink = "";
    let accent = "";

    const readPalette = () => {
      const style = getComputedStyle(canvas);
      ink = style.getPropertyValue("--foreground").trim();
      accent = style.getPropertyValue("--spark").trim();
    };

    const wave = (x: number, base: number, index: number, time: number) => {
      const nx = x / width;
      return (
        base +
        Math.sin(nx * 5.5 + time * 0.4 + index * 0.25) * 9 +
        Math.sin(nx * 11 - time * 0.25 + index * 0.1) * 4 +
        Math.sin(nx * 2.2 - time * 0.18) * 7
      );
    };

    const contourY = (x: number, base: number, index: number, time: number) => {
      let y = wave(x, base, index, time);
      if (cursor.power < 0.01) return y;
      const dx = x - cursor.x;
      const dy = y - cursor.y;
      const distance = dx * dx + dy * dy;
      if (distance > CURSOR_RADIUS * CURSOR_RADIUS) return y;
      const t = Math.sqrt(distance) / CURSOR_RADIUS;
      const falloff = (1 - t * t) * (1 - t * t);
      const pull = falloff * cursor.power;
      y -= dy * pull * 0.8;
      y += Math.sin(t * 9 - time * 2.6) * 4 * pull;
      return y;
    };

    const paint = (time: number) => {
      context.clearRect(0, 0, width, height);
      context.lineWidth = 1;
      context.lineCap = "round";
      const lines = Math.ceil(height / GAP) + 2;
      for (let index = 0; index < lines; index += 1) {
        const base = (index - 1) * GAP;
        const highlight = index % 9 === 0;
        context.strokeStyle = highlight ? accent : ink;
        context.globalAlpha = highlight ? 0.45 : 0.13;
        context.beginPath();
        for (let x = -10; x <= width + 10; x += STEP) {
          const y = contourY(x, base, index, time);
          if (x === -10) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }

      if (cursor.power > 0.01) {
        const halo = context.createLinearGradient(
          cursor.x - CURSOR_RADIUS,
          0,
          cursor.x + CURSOR_RADIUS,
          0,
        );
        halo.addColorStop(0, "rgba(0,0,0,0)");
        halo.addColorStop(0.5, accent);
        halo.addColorStop(1, "rgba(0,0,0,0)");
        for (let index = 0; index < lines; index += 1) {
          const base = (index - 1) * GAP;
          const near = Math.exp(-((base - cursor.y) ** 2) / 20000) * cursor.power;
          if (near < 0.04) continue;
          context.strokeStyle = halo;
          context.globalAlpha = near * 0.75;
          context.beginPath();
          const from = Math.max(-10, cursor.x - CURSOR_RADIUS);
          const to = Math.min(width + 10, cursor.x + CURSOR_RADIUS);
          for (let x = from; x <= to; x += STEP) {
            const y = contourY(x, base, index, time);
            if (x === from) context.moveTo(x, y);
            else context.lineTo(x, y);
          }
          context.stroke();
        }
      }
      context.globalAlpha = 1;

      context.globalCompositeOperation = "destination-out";
      context.save();
      context.translate(width / 2, height / 2 - 20);
      context.scale(1, 0.62);
      const hole = context.createRadialGradient(0, 0, 0, 0, 0, 320);
      hole.addColorStop(0, "rgba(0,0,0,0.95)");
      hole.addColorStop(0.5, "rgba(0,0,0,0.6)");
      hole.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = hole;
      context.fillRect(-width, -height, width * 2, height * 2);
      context.restore();
      context.globalCompositeOperation = "source-over";
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      if (!width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      readPalette();
      paint(still ? STILL_TIME : (performance.now() - started) / 1000);
    };

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - painted < 33) return;
      painted = now;
      const target = pointer.x > -999 ? 1 : 0;
      if (target) {
        if (cursor.power < 0.02) {
          cursor.x = pointer.x;
          cursor.y = pointer.y;
        }
        cursor.x += (pointer.x - cursor.x) * 0.16;
        cursor.y += (pointer.y - cursor.y) * 0.16;
      }
      cursor.power += (target - cursor.power) * 0.12;
      if (now - paletteAt > 1000) {
        paletteAt = now;
        readPalette();
      }
      paint((now - started) / 1000);
    };

    const move = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      if (!still) return;
      cursor.x = pointer.x;
      cursor.y = pointer.y;
      cursor.power = 1;
      const now = performance.now();
      if (now - staticPainted > 30) {
        staticPainted = now;
        paint(STILL_TIME);
      }
    };

    const leave = () => {
      pointer.x = -9999;
      pointer.y = -9999;
      if (!still) return;
      cursor.power = 0;
      paint(STILL_TIME);
    };

    const visibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (!reduced && !frame) {
        painted = 0;
        frame = requestAnimationFrame(loop);
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const theme = new MutationObserver(() => {
      readPalette();
      paint(still ? STILL_TIME : (performance.now() - started) / 1000);
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseleave", leave);
    document.addEventListener("visibilitychange", visibility);
    resize();
    if (!reduced) frame = requestAnimationFrame(loop);
    started = performance.now();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      theme.disconnect();
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseleave", leave);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [motion]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 size-full [mask-image:linear-gradient(to_bottom,transparent,black_14%,black_78%,transparent)]",
        className,
      )}
    />
  );
}
