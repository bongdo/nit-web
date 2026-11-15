import { describe, expect, it } from "vitest";
import { cropBox, cropPixels, cropReady, croppedName } from "./crop";

describe("crop", () => {
  it("sorts a dragged box and clamps it to the photo", () => {
    expect(cropBox({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.1 })).toEqual({
      left: 0.2,
      top: 0.1,
      right: 0.8,
      bottom: 0.9,
    });
    expect(cropBox({ x: -1, y: 2 }, { x: 2, y: 3 })).toEqual({
      left: 0,
      top: 1,
      right: 1,
      bottom: 1,
    });
    expect(cropBox({ x: Number.NaN, y: 0.5 }, { x: 0.5, y: 0.5 }).left).toBe(0);
  });

  it("maps fractions onto natural pixels", () => {
    expect(
      cropPixels({ left: 0.25, top: 0.5, right: 0.75, bottom: 1 }, 400, 200),
    ).toEqual({ x: 100, y: 100, width: 200, height: 100 });
  });

  it("never leaves the image when rounding", () => {
    const area = cropPixels({ left: 0.45, top: 0.45, right: 1, bottom: 1 }, 10, 10);
    expect(area.x + area.width).toBeLessThanOrEqual(10);
    expect(area.y + area.height).toBeLessThanOrEqual(10);
  });

  it("keeps a supported type and falls back to png", () => {
    expect(croppedName("photo.JPG", "image/jpeg")).toBe("photo-crop.jpg");
    expect(croppedName("shot.png", "image/png")).toBe("shot-crop.png");
    expect(croppedName("anim.gif", "image/png")).toBe("anim-crop.png");
    expect(croppedName("photo-crop.png", "image/png")).toBe("photo-crop.png");
  });

  it("only accepts a usable selection", () => {
    expect(cropReady(null)).toBe(false);
    expect(cropReady(cropBox({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }))).toBe(false);
    expect(cropReady({ left: 0, top: 0, right: 1, bottom: 1 })).toBe(true);
  });
});
