/**
 * Pure color math utilities — hex manipulation, RGB conversion, blending.
 */

export const colorNameToHex: Record<string, string> = {
  orange: "#fed7aa", emerald: "#a7f3d0", purple: "#e9d5ff", blue: "#bfdbfe",
  slate: "#cbd5e1", indigo: "#c7d2fe", gray: "#d1d5db", cyan: "#cffafe",
  teal: "#ccfbf1", rose: "#ffe4e6", amber: "#fef3c7", violet: "#ede9fe",
  lime: "#ecfccb", sky: "#e0f2fe",
};

export const colorNameToTextHex: Record<string, string> = {
  orange: "#c2410c", emerald: "#047857", purple: "#7e22ce", blue: "#1d4ed8",
  slate: "#334155", indigo: "#4338ca", gray: "#374151", cyan: "#0e7490",
  teal: "#0f766e", rose: "#be123c", amber: "#b45309", violet: "#6d28d9",
  lime: "#4d7c0f", sky: "#0369a1",
};

export const colorNameToWaffleHex: Record<string, string> = {
  orange: "#fb923c", emerald: "#34d399", purple: "#c084fc", blue: "#60a5fa",
  slate: "#94a3b8", indigo: "#818cf8", gray: "#9ca3af", cyan: "#22d3ee",
  teal: "#2dd4bf", rose: "#fb7185", amber: "#fbbf24", violet: "#8b5cf6",
  lime: "#a3e635", sky: "#38bdf8",
};

export function isHexColor(value: string): boolean {
  return value.startsWith("#");
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return { r: 156, g: 163, b: 175 };
  }
  return {
    r: parseInt(result[1]!, 16),
    g: parseInt(result[2]!, 16),
    b: parseInt(result[3]!, 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(n)));
    return clamped.toString(16).padStart(2, "0");
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function lightenColor(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

export function darkenColor(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

export function blendColors(hexColors: string[]): string {
  if (hexColors.length === 0) return colorNameToWaffleHex.gray!;
  if (hexColors.length === 1) return hexColors[0]!;

  const rgbs = hexColors.map(hexToRgb);
  const avg = {
    r: Math.round(rgbs.reduce((s, c) => s + c.r, 0) / rgbs.length),
    g: Math.round(rgbs.reduce((s, c) => s + c.g, 0) / rgbs.length),
    b: Math.round(rgbs.reduce((s, c) => s + c.b, 0) / rgbs.length),
  };
  return rgbToHex(avg.r, avg.g, avg.b);
}
