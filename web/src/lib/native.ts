type NativeBridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
};

type BackEvent = { canGoBack?: boolean };

type AppPlugin = {
  addListener: (
    event: string,
    handler: (value: BackEvent) => void,
  ) => Promise<{ remove: () => Promise<void> }>;
  exitApp: () => Promise<void>;
};

type StatusBarPlugin = {
  setStyle: (options: { style: string }) => Promise<void>;
};

function bridge(): NativeBridge | undefined {
  return (globalThis as { Capacitor?: NativeBridge }).Capacitor;
}

export function nativePlatform(): boolean {
  return bridge()?.isNativePlatform?.() === true;
}

export function nativeAndroid(): boolean {
  return nativePlatform() && bridge()?.getPlatform?.() === "android";
}

export function nativePlugin<T>(name: string): T | undefined {
  return bridge()?.Plugins?.[name] as T | undefined;
}

export function markNative(): boolean {
  if (!nativePlatform()) return false;
  document.documentElement.classList.add("native-app");
  return true;
}

export function exitApp(): void {
  void nativePlugin<AppPlugin>("App")?.exitApp().catch(() => {});
}

export function onBackButton(handler: (canGoBack: boolean) => void): () => void {
  const app = nativePlugin<AppPlugin>("App");
  if (!app) return () => {};
  const added = app.addListener("backButton", (event) => handler(Boolean(event?.canGoBack)));
  return () => {
    void added.then((handle) => handle.remove()).catch(() => {});
  };
}

export function syncStatusBar(dark: boolean): void {
  void nativePlugin<StatusBarPlugin>("StatusBar")?.setStyle({ style: dark ? "DARK" : "LIGHT" }).catch(
    () => {},
  );
}
