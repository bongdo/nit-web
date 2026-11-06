import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";

const GAP = 24;
const STEP = 5;
const sampling = (extentWidth: number) =>
  extentWidth <= 1600
    ? { step: STEP, gap: GAP }
    : extentWidth <= 2400
      ? { step: 7, gap: 28 }
      : { step: 9, gap: 32 };
const STILL_TIME = 6;
const CURSOR_RADIUS = 150;
const SPOTLIGHT_RADIUS = 290;
const SPOTLIGHT_GAP = 26;
const WAVE_SPAN = 1280;
export const VARIANTS = [
  "spotlight",
  "magnetic",
  "split",
  "ripple",
  "diagonal",
  "bend",
  "warp",
  "flow",
  "sheen",
  "fold",
  "spiral",
] as const;

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
    const pointerClient = { x: -9999, y: -9999 };
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
    let originX = 0;
    let originY = 0;
    let hasOrigin = false;

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

    const shapeFor = (
      kind: SceneVariant,
      span: number,
      cx: number,
      cy: number,
      shift: number,
    ) => {
      return (x: number, base: number, index: number, time: number) => {
        let y = wave(x + shift, base, index, time, span);
        if (cursor.power < 0.01) return y;
        const dx = x - cx;
        const dy = y - cy;
        if (kind === "ripple") {
          const distance = Math.sqrt(dx * dx + dy * dy);
          const falloff = Math.exp(-distance / 230) * cursor.power;
          return y + Math.sin(distance * 0.075 - time * 3.1) * 15 * falloff;
        }
        if (kind === "fold") {
          const creaseX = ((time * 0.055) % 1) * (width + 400) - 200;
          const fade = Math.exp(-(((base - cy) / 260) ** 2)) * cursor.power;
          y += Math.tanh((x - creaseX) / 30) * 46 * fade;
          y -= dy * Math.exp(-(dx * dx + dy * dy) / (300 * 300)) * 0.25 * cursor.power;
          return y;
        }
        if (kind === "spiral") {
          const distance = Math.sqrt(dx * dx + dy * dy) || 1;
          const angle =
            (0.8 + Math.sin(time * 0.5) * 0.35) * Math.exp(-distance / 260) * cursor.power;
          return cy + dx * Math.sin(angle) + dy * Math.cos(angle);
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

    type FieldBounds = { x0: number; x1: number; y0: number; y1: number };

    const drawField = (
      time: number,
      extentWidth: number,
      extentHeight: number,
      span: number,
      cx: number,
      cy: number,
      kind: SceneVariant,
      {
        gapScale = 1,
        shift = 0,
        bounds,
        step: stepOverride,
      }: { gapScale?: number; shift?: number; bounds?: FieldBounds; step?: number } = {},
    ) => {
      const shape = shapeFor(kind, span, cx, cy, shift);
      const sampled = sampling(extentWidth);
      const step = stepOverride ?? sampled.step;
      const fieldGap = sampled.gap * gapScale;
      const radius = kind === "ripple" ? 240 : CURSOR_RADIUS;
      const lines = Math.ceil(extentHeight / fieldGap) + 2;
      const margin = 60;
      const first = bounds
        ? Math.max(0, Math.ceil((bounds.y0 - margin) / fieldGap) + 1)
        : 0;
      const last = bounds
        ? Math.min(lines - 1, Math.floor((bounds.y1 + margin) / fieldGap) + 1)
        : lines - 1;
      const from = bounds ? Math.max(-10, bounds.x0 - margin) : -10;
      const to = bounds
        ? Math.min(extentWidth + 10, bounds.x1 + margin)
        : extentWidth + 10;

      for (let index = first; index <= last; index += 1) {
        const base = (index - 1) * fieldGap;
        const highlight = index % 9 === 0;
        context.strokeStyle = highlight ? accent : ink;
        context.globalAlpha = highlight ? 0.45 : 0.13;
        context.beginPath();
        for (let x = from; x <= to; x += step) {
          const y = shape(x, base, index, time);
          if (x === from) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }

      const haloFrom = Math.max(from, cx - radius);
      const haloTo = Math.min(to, cx + radius);
      if (cursor.power > 0.01 && haloTo > haloFrom) {
        const halo = context.createLinearGradient(cx - radius, 0, cx + radius, 0);
        halo.addColorStop(0, "rgba(0,0,0,0)");
        halo.addColorStop(0.5, accent);
        halo.addColorStop(1, "rgba(0,0,0,0)");
        for (let index = first; index <= last; index += 1) {
          const base = (index - 1) * fieldGap;
          const near = Math.exp(-((base - cy) ** 2) / 20000) * cursor.power;
          if (near < 0.04) continue;
          context.strokeStyle = halo;
          context.globalAlpha = near * 0.75;
          context.beginPath();
          for (let x = haloFrom; x <= haloTo; x += step) {
            const y = shape(x, base, index, time);
            if (x === haloFrom) context.moveTo(x, y);
            else context.lineTo(x, y);
          }
          context.stroke();
        }
      }
      context.globalAlpha = 1;
    };

    const hexA = (hex: string, a: number) =>
      `${hex}${Math.round(a * 255)
        .toString(16)
        .padStart(2, "0")}`;
    const darkTheme = () => document.documentElement.classList.contains("dark");
    const aurora = {
      dark: ["#34d399", "#22d3ee", "#a78bfa", "#f472b6"],
      light: ["#0d9488", "#0284c7", "#7c3aed", "#db2777"],
    };

    const paintBend = (time: number) => {
      const dark = darkTheme();
      const colors = aurora[dark ? "dark" : "light"];
      context.globalCompositeOperation = dark ? "lighter" : "source-over";
      const bands = 9;
      for (let band = 0; band < bands; band += 1) {
        const base = ((band + 0.5) / bands) * height;
        const thick = 38 + (band % 3) * 22;
        const liftY = cursor.y - base;
        const grad = context.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, hexA(colors[band % 4], dark ? 0.16 : 0.1));
        grad.addColorStop(0.5, hexA(colors[(band + 1) % 4], dark ? 0.22 : 0.14));
        grad.addColorStop(1, hexA(colors[band % 4], 0));
        const top: [number, number][] = [];
        for (let x = -20; x <= width + 20; x += 12) {
          const dx = x - cursor.x;
          const near =
            Math.exp(-(dx * dx) / (195 * 195)) *
            Math.exp(-(liftY * liftY) / (165 * 165)) *
            cursor.power;
          top.push([
            x,
            base +
              Math.sin(x * (0.0042 + band * 0.0005) + time * (0.1 + band * 0.022) + band * 1.7) *
                (24 + band * 5) +
              Math.tanh(liftY / 70) * near * 78,
          ]);
        }
        context.fillStyle = grad;
        context.beginPath();
        top.forEach(([x, y], i) => {
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        for (let i = top.length - 1; i >= 0; i -= 1) {
          context.lineTo(top[i][0], top[i][1] + thick);
        }
        context.closePath();
        context.fill();
        context.strokeStyle = hexA(colors[(band + 1) % 4], dark ? 0.32 : 0.18);
        context.globalAlpha = 1;
        context.beginPath();
        top.forEach(([x, y], i) => {
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.stroke();
      }
      if (cursor.power > 0.01) {
        const glow = context.createRadialGradient(
          cursor.x,
          cursor.y,
          0,
          cursor.x,
          cursor.y,
          190,
        );
        glow.addColorStop(0, hexA(colors[0], dark ? 0.14 : 0.08));
        glow.addColorStop(1, hexA(colors[0], 0));
        context.fillStyle = glow;
        context.fillRect(cursor.x - 200, cursor.y - 200, 400, 400);
      }
      context.globalCompositeOperation = "source-over";
    };

    const paintWarp = (time: number) => {
      const wells = [
        { x: cursor.x, y: cursor.y, m: 4200 * cursor.power },
        {
          x: width * (0.5 + Math.sin(time * 0.19) * 0.3),
          y: height * (0.5 + Math.cos(time * 0.15) * 0.26),
          m: 2600,
        },
      ];
      const warp = (x: number, y: number): [number, number] => {
        let dx = 0;
        let dy = 0;
        for (const well of wells) {
          const ox = x - well.x;
          const oy = y - well.y;
          const force = well.m / (ox * ox + oy * oy + 2600);
          dx += ox * force;
          dy += oy * force;
        }
        const len = Math.hypot(dx, dy);
        if (len > 46) {
          dx *= 46 / len;
          dy *= 46 / len;
        }
        return [x + dx, y + dy];
      };
      const { step, gap } = sampling(width);
      let index = 0;
      for (let base = -gap; base <= height + gap; base += gap) {
        const near = Math.exp(-(((base - cursor.y) / 120) ** 2)) * cursor.power;
        context.strokeStyle = near > 0.25 || index % 9 === 0 ? accent : ink;
        context.globalAlpha = Math.min(0.62, (index % 9 === 0 ? 0.42 : 0.13) + near * 0.4);
        context.beginPath();
        for (let x = -gap; x <= width + gap; x += step) {
          const [wx, wy] = warp(x, base);
          if (x === -gap) context.moveTo(wx, wy);
          else context.lineTo(wx, wy);
        }
        context.stroke();
        index += 1;
      }
      for (let base = -gap; base <= width + gap; base += gap) {
        const near = Math.exp(-(((base - cursor.x) / 120) ** 2)) * cursor.power;
        context.strokeStyle = near > 0.25 || index % 9 === 0 ? accent : ink;
        context.globalAlpha = Math.min(0.62, (index % 9 === 0 ? 0.42 : 0.13) + near * 0.4);
        context.beginPath();
        for (let y = -gap; y <= height + gap; y += step) {
          const [wx, wy] = warp(base, y);
          if (y === -gap) context.moveTo(wx, wy);
          else context.lineTo(wx, wy);
        }
        context.stroke();
        index += 1;
      }
      context.globalAlpha = 1;
    };

    const paintFlow = (time: number) => {
      const { step, gap } = sampling(width);
      let index = 0;
      for (let base = -gap; base <= height + gap; base += gap) {
        context.strokeStyle = index % 9 === 0 ? accent : ink;
        context.globalAlpha = index % 9 === 0 ? 0.45 : 0.13;
        context.beginPath();
        let y = base + wave(-gap, base, index, time, WAVE_SPAN) * 0.5;
        context.moveTo(-gap, y);
        for (let x = -gap; x <= width + gap; x += step) {
          const slope =
            Math.sin(x * 0.004 + time * 0.3) * 0.5 +
            Math.sin(x * 0.011 - time * 0.5 + y * 0.01) * 0.3;
          const dx = x - cursor.x;
          const dy = y - cursor.y;
          y +=
            slope * step +
            Math.tanh(dy / 90) * Math.exp(-(dx * dx) / (260 * 260)) * cursor.power * 3;
          context.lineTo(x, y);
        }
        context.stroke();
        index += 1;
      }
      context.globalAlpha = 1;
    };

    const withAlpha = (color: string, a: number) =>
      color.startsWith("oklch(") ? color.replace(/\)\s*$/, ` / ${a})`) : color;

    const paintSheen = (time: number) => {
      const sweep = ((time * 0.05) % 1) * (width + 600) - 300;
      const at = (offset: number) =>
        Math.min(1, Math.max(0, (sweep + offset) / width));
      const { step, gap } = sampling(width);
      const dim = withAlpha(ink, 0.13);
      const warm = withAlpha(accent, 0.3);
      const hot = withAlpha(accent, 0.55);
      let index = 0;
      for (let base = -gap; base <= height + gap; base += gap) {
        const grad = context.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, dim);
        grad.addColorStop(at(-260), dim);
        grad.addColorStop(at(-70), warm);
        grad.addColorStop(at(0), hot);
        grad.addColorStop(at(70), warm);
        grad.addColorStop(at(260), dim);
        grad.addColorStop(1, dim);
        context.strokeStyle = index % 9 === 0 ? withAlpha(accent, 0.45) : grad;
        context.globalAlpha = 1;
        context.beginPath();
        for (let x = -gap; x <= width + gap; x += step) {
          const dx = x - cursor.x;
          const dy = base - cursor.y;
          const near = Math.exp(-(dx * dx + dy * dy) / (280 * 280)) * cursor.power;
          const y = wave(x, base, index, time, WAVE_SPAN) + Math.tanh(dy / 90) * near * 26;
          if (x === -gap) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
        index += 1;
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
          const y = wave(x + originX, base, index, time, WAVE_SPAN);
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

      if (chosen === "bend") {
        paintBend(time);
      } else if (chosen === "warp") {
        paintWarp(time);
      } else if (chosen === "flow") {
        paintFlow(time);
      } else if (chosen === "sheen") {
        paintSheen(time);
      } else if (chosen === "diagonal") {
        const size = Math.hypot(width, height);
        const cos = Math.SQRT1_2;
        const sin = Math.SQRT1_2;
        const local = (x: number, y: number) => ({
          x: size / 2 + (x - width / 2) * cos - (y - height / 2) * sin,
          y: size / 2 + (x - width / 2) * sin + (y - height / 2) * cos,
        });
        const cursorLocal = local(cursor.x, cursor.y);
        const corners = [local(0, 0), local(width, 0), local(0, height), local(width, height)];
        const bounds = {
          x0: Math.min(...corners.map((corner) => corner.x)),
          x1: Math.max(...corners.map((corner) => corner.x)),
          y0: Math.min(...corners.map((corner) => corner.y)),
          y1: Math.max(...corners.map((corner) => corner.y)),
        };
        context.save();
        context.translate(width / 2, height / 2);
        context.rotate(-Math.PI / 4);
        context.translate(-size / 2, -size / 2);
        drawField(time, size, size, width, cursorLocal.x, cursorLocal.y, "ripple", {
          gapScale: 1.5,
          bounds,
          step: 7,
        });
        context.restore();
      } else {
        drawField(time, width, height, WAVE_SPAN, cursor.x, cursor.y, chosen, {
          shift: originX,
        });
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
      if (hasOrigin) {
        cursor.x -= rect.left - originX;
        cursor.y -= rect.top - originY;
      }
      originX = rect.left;
      originY = rect.top;
      hasOrigin = true;
      if (pointerClient.x > -9999) {
        pointer.x = pointerClient.x - rect.left;
        pointer.y = pointerClient.y - rect.top;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
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
      const target = (chosen === "spotlight" ? inScene : pointer.x > -999) ? 1 : 0;
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
      pointerClient.x = event.clientX;
      pointerClient.y = event.clientY;
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
      pointerClient.x = -9999;
      pointerClient.y = -9999;
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
    const tracksPointer = window.matchMedia("(pointer: fine)").matches;
    if (tracksPointer) {
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseleave", leave);
    }
    document.addEventListener("visibilitychange", visibility);
    resize();
    if (!reduced) frame = requestAnimationFrame(loop);
    started = performance.now();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      theme.disconnect();
      if (tracksPointer) {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseleave", leave);
      }
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
