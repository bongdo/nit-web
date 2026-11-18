export const DOCK_SETTLE = 0.45;
export const DOCK_MOVE_PX = 4;
export const DOCK_FADE_OUT = 0.06;
export const DOCK_FADE_IN = 0.05;
export const DOCK_FADE_SPAN = 0.1;
export const DOCK_FLING = 0.45;
export const DOCK_FLING_PX = 10;

export function dockProgress(from: number, dy: number, height: number): number {
  if (height <= 0) return from;
  return Math.min(1, Math.max(0, from - dy / height));
}

export function dockOpens(progress: number): boolean {
  return progress >= DOCK_SETTLE;
}

export function dockFling(velocity: number, travel: number): "open" | "close" | null {
  if (Math.abs(travel) < DOCK_FLING_PX) return null;
  if (velocity >= DOCK_FLING) return "open";
  if (velocity <= -DOCK_FLING) return "close";
  return null;
}

export function dockSettlesOpen(progress: number, velocity = 0, travel = 0): boolean {
  const fling = dockFling(velocity, travel);
  if (fling) return fling === "open";
  return dockOpens(progress);
}

export function dockComposerFade(progress: number): number {
  return Math.min(1, Math.max(0, progress / DOCK_FADE_OUT));
}

export function dockPanelFade(progress: number): number {
  return Math.min(1, Math.max(0, (progress - DOCK_FADE_IN) / DOCK_FADE_SPAN));
}
