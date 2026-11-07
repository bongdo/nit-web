export type TimeFormat = "24h" | "12h";

export function timeLabel(ms: number, format: TimeFormat, locale?: string): string {
  return new Date(ms).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(format === "24h" ? { hourCycle: "h23" as const } : { hour12: true }),
  });
}
