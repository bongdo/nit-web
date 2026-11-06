import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";

const GAP = 24;
const STEP = 5;
const STILL_TIME = 6;
const CURSOR_RADIUS = 150;
const SPOTLIGHT_RADIUS = 290;
const SPOTLIGHT_GAP = 26;
const VARIANTS = ["spotlight", "magnetic", "split", "ripple", "diagonal"] as const;

export type SceneVariant = (typeof VARIANTS)[number];
export type SceneSetting = SceneVariant | "random";

export function Scene({
  variant = "spotlight",
  motion = "animated",
  className,
}: {
  variant?: SceneSetting;
  motion?: "animated" | "static";
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const chosen =
      variant === "random" ? VARIANTS[Math.floor(Math.random() * VARIANTS.length)] : variant;
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
    let blank = true;
    let lastBox: { x: number; y: number; w: number; h: number } | null = null;
    let seenPointer = false;

    const readPalette = () => {
      const style = getComputedStyle(canvas);
      ink = style.getPropertyValue("--foreground").trim();
      accent = style.getPropertyValue("--spark").trim();
    };

    const wave = (x: number, base: number, index: number, time: number, span: number) => {
      const nx = x / span;
      return (
        base +
        Math.sin(nx * 5.5 + time * 0.4 + index * 0.25) * 9 +
        Math.sin(nx * 11 - time * 0.25 + index * 0.1) * 4 +
        Math.sin(nx * 2.2 - time * 0.18) * 7
      );
    };

    const shapeFor = (kind: SceneVariant, span: number, cx: number, cy: number) => {
      return (x: number, base: number, index: number, time: number) => {
        let y = wave(x, base, index, time, span);
        if (cursor.power < 0.01) return y;
        const dx = x - cx;
        const dy = y - cy;
        if (kind === "ripple") {
          const distance = Math.sqrt(dx * dx + dy * dy);
          const falloff = Math.exp(-distance / 230) * cursor.power;
          return y + Math.sin(distance * 0.075 - time * 3.1) * 15 * falloff;
        }
        const space = dx * dx + dy * dy;
        if (space > CURSOR_RADIUS * CURSOR_RADIUS) return y;
        const q = Math.sqrt(space) / CURSOR_RADIUS;
        const strength = (1 - q * q) * (1 - q * q) * cursor.power;
        if (kind === "split") return y + Math.tanh(dy / 30) * strength * 38;
        y -= dy * strength * 0.8;
        y += Math.sin(q * 9 - time * 2.6) * 4 * strength;
        return y;
      };
    };

    const drawField = (
      time: number,
      extentWidth: number,
      extentHeight: number,
      span: number,
      cx: number,
      cy: number,
      kind: SceneVariant,
      gap = GAP,
    ) => {
      const shape = shapeFor(kind, span, cx, cy);
      const radius = kind === "ripple" ? 240 : CURSOR_RADIUS;
      const lines = Math.ceil(extentHeight / gap) + 2;
      for (let index = 0; index < lines; index += 1) {
        const base = (index - 1) * gap;
        const highlight = index % 9 === 0;
        context.strokeStyle = highlight ? accent : ink;
        context.globalAlpha = highlight ? 0.45 : 0.13;
        context.beginPath();
        for (let x = -10; x <= extentWidth + 10; x += STEP) {
          const y = shape(x, base, index, time);
          if (x === -10) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }

      if (cursor.power > 0.01) {
        const halo = context.createLinearGradient(cx - radius, 0, cx + radius, 0);
        halo.addColorStop(0, "rgba(0,0,0,0)");
        halo.addColorStop(0.5, accent);
        halo.addColorStop(1, "rgba(0,0,0,0)");
        for (let index = 0; index < lines; index += 1) {
          const base = (index - 1) * gap;
          const near = Math.exp(-((base - cy) ** 2) / 20000) * cursor.power;
          if (near < 0.04) continue;
          context.strokeStyle = halo;
          context.globalAlpha = near * 0.75;
          context.beginPath();
          const from = Math.max(-10, cx - radius);
          const to = Math.min(extentWidth + 10, cx + radius);
          for (let x = from; x <= to; x += STEP) {
            const y = shape(x, base, index, time);
            if (x === from) context.moveTo(x, y);
            else context.lineTo(x, y);
          }
          context.stroke();
        }
      }
      context.globalAlpha = 1;
    };

    const paintSpotlight = (time: number) => {
      if (cursor.power < 0.02) {
        if (!blank) {
          if (lastBox) context.clearRect(lastBox.x, lastBox.y, lastBox.w, lastBox.h);
          else context.clearRect(0, 0, width, height);
          lastBox = null;
          blank = true;
        }
        return;
      }

      if (lastBox) context.clearRect(lastBox.x, lastBox.y, lastBox.w, lastBox.h);
      else if (!blank) context.clearRect(0, 0, width, height);
      blank = false;

      const pad = 30;
      const left = Math.max(0, cursor.x - SPOTLIGHT_RADIUS - pad);
      const top = Math.max(0, cursor.y - SPOTLIGHT_RADIUS - pad);
      const right = Math.min(width, cursor.x + SPOTLIGHT_RADIUS + pad);
      const bottom = Math.min(height, cursor.y + SPOTLIGHT_RADIUS + pad);
      if (right <= left || bottom <= top) {
        lastBox = null;
        blank = true;
        return;
      }
      lastBox = { x: left, y: top, w: right - left, h: bottom - top };

      const lines = Math.ceil(height / SPOTLIGHT_GAP) + 2;
      const first = Math.max(
        0,
        Math.floor((cursor.y - SPOTLIGHT_RADIUS) / SPOTLIGHT_GAP) - 2,
      );
      const last = Math.min(
        lines - 1,
        Math.ceil((cursor.y + SPOTLIGHT_RADIUS) / SPOTLIGHT_GAP) + 2,
      );
      const from = Math.max(-10, cursor.x - SPOTLIGHT_RADIUS - 20);
      const to = Math.min(width + 10, cursor.x + SPOTLIGHT_RADIUS + 20);

      const shade = context.createRadialGradient(
        cursor.x,
        cursor.y,
        0,
        cursor.x,
        cursor.y,
        SPOTLIGHT_RADIUS,
      );
      shade.addColorStop(0, accent);
      shade.addColorStop(0.55, accent);
      shade.addColorStop(1, "transparent");

      context.strokeStyle = shade;
      context.lineWidth = 1.1;
      context.lineCap = "round";
      context.globalAlpha = 0.6 * cursor.power;
      for (let index = first; index <= last; index += 1) {
        const base = (index - 1) * SPOTLIGHT_GAP;
        context.beginPath();
        for (let x = from; x <= to; x += STEP) {
          const y = wave(x, base, index, time, width);
          if (x === from) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }
      context.globalAlpha = 1;
    };

    const paint = (time: number) => {
      if (chosen === "spotlight") {
        paintSpotlight(time);
        return;
      }

      context.clearRect(0, 0, width, height);
      context.lineWidth = 1;
      context.lineCap = "round";

      if (chosen === "diagonal") {
        const size = Math.hypot(width, height);
        const cos = Math.SQRT1_2;
        const sin = Math.SQRT1_2;
        const dx = cursor.x - width / 2;
        const dy = cursor.y - height / 2;
        const localX = size / 2 + dx * cos - dy * sin;
        const localY = size / 2 + dx * sin + dy * cos;
        context.save();
        context.translate(width / 2, height / 2);
        context.rotate(-Math.PI / 4);
        context.translate(-size / 2, -size / 2);
        drawField(time, size, size, width, localX, localY, "magnetic", GAP * Math.SQRT1_2);
        context.restore();
      } else {
        drawField(time, width, height, width, cursor.x, cursor.y, chosen);
      }

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
      const dpr = Math.min(window.devicePixelRatio || 1, chosen === "spotlight" ? 1.5 : 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      blank = true;
      lastBox = null;
      if (chosen === "spotlight" && !seenPointer) {
        cursor.x = width * 0.63;
        cursor.y = height * 0.42;
        cursor.power = 1;
      }
      readPalette();
      paint(still ? STILL_TIME : (performance.now() - started) / 1000);
    };

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - painted < 33) return;
      painted = now;
      const inScene =
        pointer.x > -999 &&
        pointer.x > -40 &&
        pointer.x < width + 40 &&
        pointer.y > -40 &&
        pointer.y < height + 40;
      const target = chosen === "spotlight" ? (inScene ? 1 : 0) : pointer.x > -999 ? 1 : 0;
      if (target) {
        if (cursor.power < 0.02) {
          cursor.x = pointer.x;
          cursor.y = pointer.y;
        }
        cursor.x += (pointer.x - cursor.x) * 0.16;
        cursor.y += (pointer.y - cursor.y) * 0.16;
      }
      if (seenPointer || chosen !== "spotlight") {
        cursor.power += (target - cursor.power) * 0.12;
      }
      if (now - paletteAt > 1000) {
        paletteAt = now;
        readPalette();
      }
      if (chosen === "spotlight" && cursor.power < 0.02) {
        paint((now - started) / 1000);
        cancelAnimationFrame(frame);
        frame = 0;
        return;
      }
      paint((now - started) / 1000);
    };

    const move = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      seenPointer = true;
      if (!still) {
        if (chosen === "spotlight" && !frame) {
          painted = 0;
          frame = requestAnimationFrame(loop);
        }
        return;
      }
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
  }, [motion, variant]);

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
