import type { SceneSetting } from "../components/Scene";

export type BackgroundEntry = {
  id: SceneSetting;
  label: string;
  hint: string;
  menu: string;
  group: string;
};

export const BACKGROUNDS: BackgroundEntry[] = [
  { id: "spotlight", label: "Spotlight", hint: "contours", menu: "Contours · spotlight", group: "canvas" },
  { id: "magnetic", label: "Magnetic", hint: "contours", menu: "Contours · magnetic", group: "canvas" },
  { id: "split", label: "Split", hint: "contours", menu: "Contours · split", group: "canvas" },
  { id: "ripple", label: "Ripple", hint: "contours", menu: "Contours · ripple", group: "canvas" },
  { id: "diagonal", label: "Diagonal", hint: "contours", menu: "Contours · diagonal", group: "canvas" },
  { id: "bend", label: "Bend", hint: "aurora", menu: "Bend", group: "canvas" },
  { id: "warp", label: "Warp", hint: "grid", menu: "Warp", group: "canvas" },
  { id: "flow", label: "Flow", hint: "contours", menu: "Flow", group: "canvas" },
  { id: "sheen", label: "Sheen", hint: "contours", menu: "Sheen", group: "canvas" },
  { id: "fold", label: "Fold", hint: "contours", menu: "Fold", group: "canvas" },
  { id: "spiral", label: "Spiral", hint: "contours", menu: "Spiral", group: "canvas" },
  { id: "random", label: "Random", hint: "per chat", menu: "Random per new chat", group: "canvas" },

  { id: "gpu-magnetic", label: "Magnetic", hint: "gpu", menu: "GPU · magnetic", group: "gpu" },
  { id: "gpu-split", label: "Split", hint: "gpu", menu: "GPU · split", group: "gpu" },
  { id: "gpu-ripple", label: "Ripple", hint: "gpu", menu: "GPU · ripple", group: "gpu" },
  { id: "gpu-diagonal", label: "Diagonal", hint: "gpu", menu: "GPU · diagonal", group: "gpu" },
  { id: "gpu-fold", label: "Fold", hint: "gpu", menu: "GPU · fold", group: "gpu" },
  { id: "gpu-spiral", label: "Spiral", hint: "gpu", menu: "GPU · spiral", group: "gpu" },
  { id: "gpu-sheen", label: "Sheen", hint: "gpu", menu: "GPU · sheen", group: "gpu" },
  { id: "gpu-spotlight", label: "Spotlight", hint: "gpu", menu: "GPU · spotlight", group: "gpu" },

  { id: "ascii-blackhole", label: "Black hole", hint: "ascii", menu: "ASCII · black hole", group: "ascii" },
  { id: "ascii-jelly", label: "Jellyfish", hint: "ascii", menu: "ASCII · jellyfish", group: "ascii" },
  { id: "ascii-butterfly", label: "Butterfly", hint: "ascii", menu: "ASCII · butterfly", group: "ascii" },
  { id: "ascii-fish", label: "Fish", hint: "ascii", menu: "ASCII · fish", group: "ascii" },
  { id: "ascii-torus", label: "Torus", hint: "ascii", menu: "ASCII · torus", group: "ascii" },
  { id: "ascii-stars", label: "Stars", hint: "ascii", menu: "ASCII · stars", group: "ascii" },
];

export const BACKGROUND_GROUPS: Record<string, string> = {
  canvas: "Canvas 2D",
  gpu: "GPU · contour copies",
  ascii: "GPU · ascii",
};
