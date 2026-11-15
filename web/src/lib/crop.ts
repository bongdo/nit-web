export type CropPoint = { x: number; y: number };
export type CropBox = { left: number; top: number; right: number; bottom: number };
export type CropPixels = { x: number; y: number; width: number; height: number };

export const MIN_CROP = 0.02;

const KEEP_MIME = ["image/jpeg", "image/png", "image/webp"];

const clamp = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

export function cropBox(a: CropPoint, b: CropPoint): CropBox {
  const x = [clamp(a.x), clamp(b.x)].sort((left, right) => left - right);
  const y = [clamp(a.y), clamp(b.y)].sort((left, right) => left - right);
  return { left: x[0], top: y[0], right: x[1], bottom: y[1] };
}

export function cropReady(box: CropBox | null): box is CropBox {
  return (
    box !== null && box.right - box.left >= MIN_CROP && box.bottom - box.top >= MIN_CROP
  );
}

export function cropPixels(box: CropBox, width: number, height: number): CropPixels {
  const left = clamp(box.left);
  const top = clamp(box.top);
  const x = Math.round(left * width);
  const y = Math.round(top * height);
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.round((clamp(box.right) - left) * width))),
    height: Math.max(1, Math.min(height - y, Math.round((clamp(box.bottom) - top) * height))),
  };
}

export function croppedName(name: string, mime: string): string {
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  const base = (name.replace(/\.[^./\\]+$/, "") || "image").replace(/-crop$/, "");
  return `${base}-crop.${ext}`;
}

export async function cropFile(file: File, box: CropBox): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const area = cropPixels(box, bitmap.width, bitmap.height);
    const mime = KEEP_MIME.includes(file.type) ? file.type : "image/png";
    const canvas = document.createElement("canvas");
    canvas.width = area.width;
    canvas.height = area.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot crop images.");
    if (mime === "image/jpeg") {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, area.width, area.height);
    }
    context.drawImage(
      bitmap,
      area.x,
      area.y,
      area.width,
      area.height,
      0,
      0,
      area.width,
      area.height,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mime, 0.92),
    );
    if (!blob) throw new Error("This browser could not encode the cropped image.");
    return new File([blob], croppedName(file.name, mime), {
      type: mime,
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}
