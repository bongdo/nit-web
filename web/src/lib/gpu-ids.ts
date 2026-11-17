export type GpuScene =
  | { mode: "ascii"; label: string; hint: string; menu: string }
  | { mode: "lines"; kind: number; gap: number; label: string; hint: string; menu: string };

export const GPU_SCENES = {
  "ascii-blackhole": { mode: "ascii", label: "Black hole", hint: "ascii", menu: "ASCII · black hole" },
  "ascii-jelly": { mode: "ascii", label: "Jellyfish", hint: "ascii", menu: "ASCII · jellyfish" },
  "ascii-fish": { mode: "ascii", label: "Fish", hint: "ascii", menu: "ASCII · fish" },
  "ascii-torus": { mode: "ascii", label: "Torus", hint: "ascii", menu: "ASCII · torus" },
  "ascii-crystal": { mode: "ascii", label: "Crystal", hint: "ascii", menu: "ASCII · crystal" },
  "ascii-mobius": { mode: "ascii", label: "Möbius", hint: "ascii", menu: "ASCII · möbius" },
  "ascii-lattice": { mode: "ascii", label: "Lattice", hint: "ascii", menu: "ASCII · lattice" },
  "ascii-blob": { mode: "ascii", label: "Blob", hint: "ascii", menu: "ASCII · blob" },
  "ascii-stars": { mode: "ascii", label: "Stars", hint: "ascii", menu: "ASCII · stars" },
  "ascii-angel": { mode: "ascii", label: "Guardian", hint: "ascii", menu: "ASCII · winged guardian" },
  "ascii-gyro": { mode: "ascii", label: "Gyroscope", hint: "ascii", menu: "ASCII · gyroscope" },
  "gpu-magnetic": { mode: "lines", kind: 0, gap: 24, label: "Magnetic", hint: "gpu", menu: "GPU · magnetic" },
  "gpu-split": { mode: "lines", kind: 1, gap: 24, label: "Split", hint: "gpu", menu: "GPU · split" },
  "gpu-ripple": { mode: "lines", kind: 2, gap: 24, label: "Ripple", hint: "gpu", menu: "GPU · ripple" },
  "gpu-diagonal": { mode: "lines", kind: 3, gap: 24, label: "Diagonal", hint: "gpu", menu: "GPU · diagonal" },
  "gpu-fold": { mode: "lines", kind: 4, gap: 24, label: "Fold", hint: "gpu", menu: "GPU · fold" },
  "gpu-spiral": { mode: "lines", kind: 5, gap: 24, label: "Spiral", hint: "gpu", menu: "GPU · spiral" },
  "gpu-sheen": { mode: "lines", kind: 6, gap: 24, label: "Sheen", hint: "gpu", menu: "GPU · sheen" },
  "gpu-spotlight": { mode: "lines", kind: 7, gap: 26, label: "Spotlight", hint: "gpu", menu: "GPU · spotlight" },
} satisfies Record<string, GpuScene>;

export type GpuVariant = keyof typeof GPU_SCENES;
export const GPU_VARIANTS = Object.keys(GPU_SCENES) as GpuVariant[];

export const isGpuVariant = (value: string): value is GpuVariant => value in GPU_SCENES;
