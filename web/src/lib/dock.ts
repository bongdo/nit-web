export const DOCK_SETTLE = 0.45;
export const DOCK_MOVE_PX = 4;

export function dockProgress(from: number, dy: number, height: number): number {
  if (height <= 0) return from;
  return Math.min(1, Math.max(0, from - dy / height));
}

export function dockOpens(progress: number): boolean {
  return progress >= DOCK_SETTLE;
}
