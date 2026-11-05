import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";

type Seed = { x: number; y: number; accent: boolean };

const STEP = 44;
const SEGMENTS = 12;
const SEGMENT_LENGTH = 7;
const FRAME_MS = 33;

export function Scene({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mouse = { x: -1e4, y: -1e4 };
    let seeds: Seed[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let started = performance.now();
    let painted = 0;
    let paletteAt = 0;
    let ink = "";
    let accent = "";

    const readPalette = () => {
      const style = getComputedStyle(canvas);
      ink = style.getPropertyValue("--foreground").trim();
      accent = style.getPropertyValue("--spark").trim();
    };

    const angle = (x: number, y: number, time: number) => {
      const nx = x / width;
      const ny = y / height;
      const base =
        Math.sin(nx * 4.2 + ny * 2.1 + time * 0.22) * 1.5 +
        Math.cos(ny * 6.4 - nx * 1.6 - time * 0.15) * 1.1 +
        Math.sin((nx + ny) * 3.0 + time * 0.09) * 0.7;
      const dx = x - mouse.x;
      const dy = y - mouse.y;
      const distance = dx * dx + dy * dy;
      if (distance > 32400 || distance < 1) return base;
      const length = Math.sqrt(distance);
      return base + (dx / length) * 2.2 * (1 - length / 180);
    };

    const paint = (time: number) => {
      context.clearRect(0, 0, width, height);
      context.lineWidth = 1;
      context.lineCap = "round";
      const pass = (accented: boolean, color: string, alpha: number) => {
        context.strokeStyle = color;
        context.globalAlpha = alpha;
        context.beginPath();
        for (const seed of seeds) {
          if (seed.accent !== accented) continue;
          let x = seed.x;
          let y = seed.y;
          context.moveTo(x, y);
          for (let i = 0; i < SEGMENTS; i += 1) {
            const a = angle(x, y, time);
            x += Math.cos(a) * SEGMENT_LENGTH;
            y += Math.sin(a) * SEGMENT_LENGTH;
            context.lineTo(x, y);
          }
          x = seed.x;
          y = seed.y;
          for (let i = 0; i < SEGMENTS; i += 1) {
            const a = angle(x, y, time);
            x -= Math.cos(a) * SEGMENT_LENGTH;
            y -= Math.sin(a) * SEGMENT_LENGTH;
            context.lineTo(x, y);
          }
        }
        context.stroke();
      };
      pass(false, ink, 0.09);
      pass(true, accent, 0.34);
      context.globalAlpha = 1;
      context.globalCompositeOperation = "destination-out";
      context.save();
      context.translate(width / 2, height / 2 - 20);
      context.scale(1, 0.62);
      const hole = context.createRadialGradient(0, 0, 0, 0, 0, 330);
      hole.addColorStop(0, "rgba(0,0,0,0.96)");
      hole.addColorStop(0.45, "rgba(0,0,0,0.7)");
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
      seeds = [];
      for (let y = -STEP; y < height + STEP; y += STEP) {
        for (let x = -STEP; x < width + STEP; x += STEP) {
          seeds.push({
            x: x + (Math.random() - 0.5) * STEP,
            y: y + (Math.random() - 0.5) * STEP,
            accent: Math.random() < 0.045,
          });
        }
      }
      readPalette();
      paint((performance.now() - started) / 1000);
    };

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - painted < FRAME_MS) return;
      painted = now;
      if (now - paletteAt > 1000) {
        paletteAt = now;
        readPalette();
      }
      paint((now - started) / 1000);
    };

    const move = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = event.clientX - rect.left;
      mouse.y = event.clientY - rect.top;
    };

    const leave = () => {
      mouse.x = -1e4;
      mouse.y = -1e4;
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
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseleave", leave);
    document.addEventListener("visibilitychange", visibility);
    resize();
    if (!reduced) frame = requestAnimationFrame(loop);
    started = performance.now();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseleave", leave);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

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
