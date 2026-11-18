export const DOCK_SETTLE = 0.45;
export const DOCK_MOVE_PX = 4;
export const DOCK_FADE_OUT = 0.06;
export const DOCK_FADE_IN = 0.05;
export const DOCK_FADE_SPAN = 0.1;

export function dockProgress(from: number, dy: number, height: number): number {
  if (height <= 0) return from;
  return Math.min(1, Math.max(0, from - dy / height));
}

export function dockOpens(progress: number): boolean {
  return progress >= DOCK_SETTLE;
}

export function dockComposerFade(progress: number): number {
  return Math.min(1, Math.max(0, progress / DOCK_FADE_OUT));
}

export function dockPanelFade(progress: number): number {
  return Math.min(1, Math.max(0, (progress - DOCK_FADE_IN) / DOCK_FADE_SPAN));
}
