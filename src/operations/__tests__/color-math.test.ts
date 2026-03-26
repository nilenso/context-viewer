/**
 * Tests for color-math pure functions.
 *
 * Ground truth: PC1_COLORS and SEG1_COLORS from recordings contain
 * hex colors like "#60a5fa" that these functions operate on.
 */
import { describe, it, expect } from "vitest";
import {
  isHexColor,
  hexToRgb,
  rgbToHex,
  lightenColor,
  darkenColor,
  blendColors,
  colorNameToHex,
  colorNameToWaffleHex,
} from "@/operations/color-math";
import { PC1_COLORS, SEG1_COLORS } from "@/__tests__/recording-fixtures";

describe("isHexColor", () => {
  it("returns true for hex colors from recordings", () => {
    for (const color of Object.values(PC1_COLORS)) {
      expect(isHexColor(color)).toBe(true);
    }
  });

  it("returns false for named colors", () => {
    expect(isHexColor("gray")).toBe(false);
    expect(isHexColor("blue")).toBe(false);
  });
});

describe("hexToRgb", () => {
  it("converts recording color #60a5fa correctly", () => {
    expect(hexToRgb("#60a5fa")).toEqual({ r: 96, g: 165, b: 250 });
  });

  it("converts #34d399 correctly", () => {
    expect(hexToRgb("#34d399")).toEqual({ r: 52, g: 211, b: 153 });
  });

  it("converts #000000 and #ffffff", () => {
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("returns gray fallback for invalid hex", () => {
    expect(hexToRgb("not-a-color")).toEqual({ r: 156, g: 163, b: 175 });
  });
});

describe("rgbToHex", () => {
  it("roundtrips with hexToRgb for recording colors", () => {
    for (const hex of Object.values(SEG1_COLORS)) {
      const { r, g, b } = hexToRgb(hex);
      expect(rgbToHex(r, g, b)).toBe(hex);
    }
  });

  it("clamps out-of-range values", () => {
    expect(rgbToHex(300, -10, 128)).toBe("#ff0080");
  });
});

describe("lightenColor", () => {
  it("lighten by 0 returns same color", () => {
    expect(lightenColor("#60a5fa", 0)).toBe("#60a5fa");
  });

  it("lighten by 1 returns white", () => {
    expect(lightenColor("#60a5fa", 1)).toBe("#ffffff");
  });

  it("lighten moves toward white", () => {
    const result = lightenColor("#000000", 0.5);
    const { r, g, b } = hexToRgb(result);
    expect(r).toBeGreaterThan(0);
    expect(g).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
  });
});

describe("darkenColor", () => {
  it("darken by 0 returns same color", () => {
    expect(darkenColor("#60a5fa", 0)).toBe("#60a5fa");
  });

  it("darken by 1 returns black", () => {
    expect(darkenColor("#60a5fa", 1)).toBe("#000000");
  });
});

describe("blendColors", () => {
  it("single color returns itself", () => {
    expect(blendColors(["#60a5fa"])).toBe("#60a5fa");
  });

  it("empty array returns gray", () => {
    expect(blendColors([])).toBe(colorNameToWaffleHex.gray);
  });

  it("blending two recording colors averages RGB", () => {
    // #60a5fa (96,165,250) and #34d399 (52,211,153) → avg (74,188,202) = #4abcca
    const result = blendColors(["#60a5fa", "#34d399"]);
    expect(result).toBe("#4abcca");
  });

  it("blending a color with itself returns the same color", () => {
    expect(blendColors(["#f97316", "#f97316"])).toBe("#f97316");
  });
});

describe("color name maps", () => {
  it("all colorNameToHex values are valid hex", () => {
    for (const hex of Object.values(colorNameToHex)) {
      expect(isHexColor(hex)).toBe(true);
      const { r, g, b } = hexToRgb(hex);
      expect(r).toBeGreaterThanOrEqual(0);
    }
  });
});
