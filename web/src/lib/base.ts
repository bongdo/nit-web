export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "");

export function appPath(path: string): string {
  return `${BASE_PATH}${path}`;
}

export function loginPath(next: string): string {
  return appPath(`/auth?next=${encodeURIComponent(next)}`);
}

export function staleBundle(currentSrc: string, html: string): boolean {
  const next =
    /<script[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/i.exec(html)?.[1] ??
    /<script[^>]*\bsrc="([^"]*assets\/[^"]+\.js)"/i.exec(html)?.[1];
  return Boolean(next && currentSrc && next !== currentSrc);
}
