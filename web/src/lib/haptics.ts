import { nativePlugin } from "./native";

type HapticsPlugin = {
  impact: (options: { style: string }) => Promise<void>;
  selectionChanged: () => Promise<void>;
};

function plugin(): HapticsPlugin | undefined {
  return nativePlugin<HapticsPlugin>("Haptics");
}

export function tap(style: "light" | "medium" | "heavy" = "light"): void {
  void plugin()?.impact({ style: style.toUpperCase() }).catch(() => {});
}

export function tick(): void {
  void plugin()?.selectionChanged().catch(() => {});
}
