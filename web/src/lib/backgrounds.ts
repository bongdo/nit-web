import type { SceneSetting } from "../components/Scene";

export const BACKGROUNDS: { id: SceneSetting; label: string; hint: string; menu: string }[] = [
  { id: "spotlight", label: "Spotlight", hint: "contours", menu: "Contours · spotlight" },
  { id: "magnetic", label: "Magnetic", hint: "contours", menu: "Contours · magnetic" },
  { id: "split", label: "Split", hint: "contours", menu: "Contours · split" },
  { id: "ripple", label: "Ripple", hint: "contours", menu: "Contours · ripple" },
  { id: "diagonal", label: "Diagonal", hint: "contours", menu: "Contours · diagonal" },
  { id: "bend", label: "Bend", hint: "aurora", menu: "Bend" },
  { id: "warp", label: "Warp", hint: "grid", menu: "Warp" },
  { id: "flow", label: "Flow", hint: "contours", menu: "Flow" },
  { id: "sheen", label: "Sheen", hint: "contours", menu: "Sheen" },
  { id: "fold", label: "Fold", hint: "contours", menu: "Fold" },
  { id: "spiral", label: "Spiral", hint: "contours", menu: "Spiral" },
  { id: "random", label: "Random", hint: "per chat", menu: "Random per new chat" },
];
