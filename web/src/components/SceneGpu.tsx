import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";
import { compile, drawTriangle, fullscreenBuffer, glyphAtlas, parseColor } from "../lib/gpu";
import {
  ASCII_SCENES,
  CHARS,
  FILL,
  GPU_SCENES,
  LINES,
  MARKS,
  TANGENTS,
  type GpuVariant,
} from "../lib/gpu-scenes";

const STILL_TIME = 6;
const scrollProgress = () => {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
};
const CELL = 11;
const GLYPH_FONT = 'ui-monospace, "SF Mono", Menlo, monospace';

const GLYPHS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uAtlas;
uniform vec2 uRes;
uniform float uRows;
out vec4 outColor;

const float COLS = 8.0;

void main() {
  vec2 g = vUV * uRes;
  vec2 cell = floor(g);
  vec4 c = texelFetch(uScene, ivec2(cell), 0);
  float slot = floor(c.a * 255.0 + 0.5);
  vec2 f = g - cell;
  vec2 atl = vec2(mod(slot, COLS), floor(slot / COLS));
  vec2 uv = (atl + f * 0.96 + 0.02) / vec2(COLS, uRows);
  float a = texture(uAtlas, uv).r;
  outColor = vec4(c.rgb * a, a);
}`;

export function SceneGpu({
  variant,
  motion = "animated",
  paused = false,
  preview = false,
  className,
}: {
  variant: GpuVariant;
  motion?: "animated" | "static";
  paused?: boolean;
  preview?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const scene = GPU_SCENES[variant];
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: true,
      powerPreference: "low-power",
    });
    if (!gl) return;

    const still = motion === "static";
    const reduced = still || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let program: WebGLProgram;
    let glyphProgram: WebGLProgram | null = null;
    try {
      program = compile(gl, scene.mode === "lines" ? LINES : ASCII_SCENES[variant as keyof typeof ASCII_SCENES]);
      if (scene.mode === "ascii") glyphProgram = compile(gl, GLYPHS);
    } catch (error) {
      console.error("gpu scene", variant, String(error));
      return;
    }

    const buffer = fullscreenBuffer(gl);
    const uniform = (name: string) => gl.getUniformLocation(program, name);

    const slots = new Map<string, number>();
    for (const char of CHARS + TANGENTS.join("") + MARKS.join("")) {
      if (!slots.has(char)) slots.set(char, slots.size);
    }
    const fill = new Float32Array(48);
    FILL.forEach((pool, row) => {
      pool.forEach((char, index) => {
        fill[row * 12 + index] = slots.get(char) ?? 0;
      });
    });
    const glyph = new Float32Array([...TANGENTS, ...MARKS].map((char) => slots.get(char) ?? 0));

    let atlas: WebGLTexture | null = null;
    let atlasRows = 1;
    if (glyphProgram) {
      const built = glyphAtlas([...slots.keys()], GLYPH_FONT);
      atlasRows = built.rows;
      atlas = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, built.canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    const sceneTexture = gl.createTexture();
    const target = gl.createFramebuffer();
    let cols = 0;
    let rows = 0;
    let width = 0;
    let height = 0;

    const ink = { current: parseColor("#888") };
    const accent = { current: parseColor("#c80") };
    const readPalette = () => {
      const style = getComputedStyle(canvas);
      ink.current = parseColor(style.getPropertyValue("--foreground") || "#888");
      accent.current = parseColor(style.getPropertyValue("--spark") || "#c80");
    };
    readPalette();

    const cursor = { x: 0, y: 0, power: 0 };
    const pointer = { x: -9999, y: -9999 };
    let started = performance.now();
    let frame = 0;
    let painted = 0;
    let paletteAt = 0;
    const kind = scene.mode === "lines" ? scene.kind : 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      width = rect.width;
      height = rect.height;
      if (scene.mode === "ascii") {
        const cellCss = preview ? 5 : CELL;
        const nextRows = Math.max(6, Math.round(height / cellCss));
        const nextCols = Math.max(6, Math.round(width / (cellCss * 0.5)));
        if (nextCols !== cols || nextRows !== rows) {
          cols = nextCols;
          rows = nextRows;
          gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, target);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTexture, 0);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
      }
      return true;
    };

    const paint = (time: number) => {
      if (!resize()) return;
      if (scene.mode === "lines") {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(program);
        gl.uniform2f(uniform("uRes"), width, height);
        gl.uniform1f(uniform("uT"), time);
        gl.uniform1i(uniform("uKind"), kind);
        gl.uniform2f(uniform("uCursor"), cursor.x, cursor.y);
        gl.uniform1f(uniform("uPower"), cursor.power);
        gl.uniform1f(uniform("uGap"), scene.gap);
        gl.uniform1f(uniform("uSpan"), 1280);
        gl.uniform3fv(uniform("uInk"), ink.current);
        gl.uniform3fv(uniform("uAccent"), accent.current);
        drawTriangle(gl, buffer);
        return;
      }

      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.viewport(0, 0, cols, rows);
      gl.useProgram(program);
      gl.uniform2f(uniform("uRes"), cols, rows);
      gl.uniform1f(uniform("uAspect"), (cols * 0.5) / rows);
      gl.uniform1f(uniform("uT"), time);
      gl.uniform1f(uniform("uScroll"), scrollProgress());
      gl.uniform3fv(uniform("uInk"), ink.current);
      gl.uniform3fv(uniform("uAccent"), accent.current);
      gl.uniform1fv(uniform("uFill"), fill);
      gl.uniform1fv(uniform("uGlyph"), glyph);
      drawTriangle(gl, buffer);

      if (!glyphProgram) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(glyphProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
      gl.uniform1i(gl.getUniformLocation(glyphProgram, "uScene"), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.uniform1i(gl.getUniformLocation(glyphProgram, "uAtlas"), 1);
      gl.uniform2f(gl.getUniformLocation(glyphProgram, "uRes"), cols, rows);
      gl.uniform1f(gl.getUniformLocation(glyphProgram, "uRows"), atlasRows);
      drawTriangle(gl, buffer);
    };

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - painted < 33) return;
      painted = now;
      const inside = pointer.x > -40 && pointer.x < width + 40 && pointer.y > -40 && pointer.y < height + 40;
      const wanted = pointer.x > -999 && inside ? 1 : 0;
      if (wanted) {
        if (cursor.power < 0.02) {
          cursor.x = pointer.x;
          cursor.y = pointer.y;
        }
        cursor.x += (pointer.x - cursor.x) * 0.16;
        cursor.y += (pointer.y - cursor.y) * 0.16;
      }
      cursor.power += (wanted - cursor.power) * 0.12;
      if (now - paletteAt > 1000) {
        paletteAt = now;
        readPalette();
      }
      paint(still ? STILL_TIME : (now - started) / 1000);
    };

    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !window.matchMedia("(min-width: 48rem)").matches) return;
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      if (!still) return;
      cursor.x = pointer.x;
      cursor.y = pointer.y;
      cursor.power = 1;
      paint(STILL_TIME);
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
      } else if (!reduced && !paused && !frame) {
        painted = 0;
        frame = requestAnimationFrame(loop);
      }
    };

    const observer = new ResizeObserver(() => {
      if (!paused) paint(still ? STILL_TIME : (performance.now() - started) / 1000);
    });
    if (!paused) observer.observe(canvas);
    const theme = new MutationObserver(() => {
      readPalette();
      if (!paused) paint(still ? STILL_TIME : (performance.now() - started) / 1000);
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });

    const tracksPointer = window.matchMedia("(pointer: fine)").matches && !paused && !(preview && still);
    if (tracksPointer) {
      window.addEventListener("pointermove", move);
      window.addEventListener("mouseleave", leave);
    }
    document.addEventListener("visibilitychange", visibility);

    started = performance.now() - (preview ? STILL_TIME * 1000 : 0);
    if (!paused) {
      paint(still ? STILL_TIME : (performance.now() - started) / 1000);
      if (preview) {
        cursor.x = width * 0.62;
        cursor.y = height * 0.42;
        cursor.power = scene.mode === "lines" ? 1 : 0;
        paint(still ? STILL_TIME : (performance.now() - started) / 1000);
      }
      if (!reduced) frame = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      theme.disconnect();
      if (tracksPointer) {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("mouseleave", leave);
      }
      document.removeEventListener("visibilitychange", visibility);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [motion, paused, preview, variant]);

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
