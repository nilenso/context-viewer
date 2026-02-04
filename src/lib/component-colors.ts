/**
 * Shared color utilities for components across different views
 */

// Map color names to Tailwind CSS classes (legacy support)
export const colorNameToClasses: Record<string, string> = {
  orange: "bg-orange-100 text-orange-700 border-orange-300",
  emerald: "bg-emerald-100 text-emerald-700 border-emerald-300",
  purple: "bg-purple-100 text-purple-700 border-purple-300",
  blue: "bg-blue-100 text-blue-700 border-blue-300",
  slate: "bg-slate-100 text-slate-700 border-slate-300",
  indigo: "bg-indigo-100 text-indigo-700 border-indigo-300",
  gray: "bg-gray-100 text-gray-700 border-gray-300",
  cyan: "bg-cyan-100 text-cyan-700 border-cyan-300",
  teal: "bg-teal-100 text-teal-700 border-teal-300",
  rose: "bg-rose-100 text-rose-700 border-rose-300",
  amber: "bg-amber-100 text-amber-700 border-amber-300",
  violet: "bg-violet-100 text-violet-700 border-violet-300",
  lime: "bg-lime-100 text-lime-700 border-lime-300",
  sky: "bg-sky-100 text-sky-700 border-sky-300",
};

// Map color names to just background Tailwind CSS classes (for WaffleChart)
export const colorNameToBgClass: Record<string, string> = {
  orange: "bg-orange-400",
  emerald: "bg-emerald-400",
  purple: "bg-purple-400",
  blue: "bg-blue-400",
  slate: "bg-slate-400",
  indigo: "bg-indigo-400",
  gray: "bg-gray-400",
  cyan: "bg-cyan-400",
  teal: "bg-teal-400",
  rose: "bg-rose-400",
  amber: "bg-amber-400",
  violet: "bg-violet-500",
  lime: "bg-lime-400",
  sky: "bg-sky-400",
};

// Map color names to hex codes for charts (light background)
export const colorNameToHex: Record<string, string> = {
  orange: "#fed7aa",
  emerald: "#a7f3d0",
  purple: "#e9d5ff",
  blue: "#bfdbfe",
  slate: "#cbd5e1",
  indigo: "#c7d2fe",
  gray: "#d1d5db",
  cyan: "#cffafe",
  teal: "#ccfbf1",
  rose: "#ffe4e6",
  amber: "#fef3c7",
  violet: "#ede9fe",
  lime: "#ecfccb",
  sky: "#e0f2fe",
};

// Map color names to hex codes for text/labels (darker for readability)
export const colorNameToTextHex: Record<string, string> = {
  orange: "#c2410c",
  emerald: "#047857",
  purple: "#7e22ce",
  blue: "#1d4ed8",
  slate: "#334155",
  indigo: "#4338ca",
  gray: "#374151",
  cyan: "#0e7490",
  teal: "#0f766e",
  rose: "#be123c",
  amber: "#b45309",
  violet: "#6d28d9",
  lime: "#4d7c0f",
  sky: "#0369a1",
};

// Map color names to waffle hex codes (the 400/500 level - more saturated)
export const colorNameToWaffleHex: Record<string, string> = {
  orange: "#fb923c",
  emerald: "#34d399",
  purple: "#c084fc",
  blue: "#60a5fa",
  slate: "#94a3b8",
  indigo: "#818cf8",
  gray: "#9ca3af",
  cyan: "#22d3ee",
  teal: "#2dd4bf",
  rose: "#fb7185",
  amber: "#fbbf24",
  violet: "#8b5cf6",
  lime: "#a3e635",
  sky: "#38bdf8",
};

/**
 * Check if a value is a hex color (starts with #)
 */
export function isHexColor(value: string): boolean {
  return value.startsWith("#");
}

/**
 * Convert hex color to RGB components
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return { r: 156, g: 163, b: 175 }; // gray-400 fallback
  }
  return {
    r: parseInt(result[1]!, 16),
    g: parseInt(result[2]!, 16),
    b: parseInt(result[3]!, 16),
  };
}

/**
 * Convert RGB to hex color
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(n)));
    return clamped.toString(16).padStart(2, "0");
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Lighten a hex color by mixing with white
 * @param hex The hex color to lighten
 * @param amount Amount to lighten (0-1, where 1 is white)
 */
export function lightenColor(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(
    r + (255 - r) * amount,
    g + (255 - g) * amount,
    b + (255 - b) * amount
  );
}

/**
 * Darken a hex color by mixing with black
 * @param hex The hex color to darken
 * @param amount Amount to darken (0-1, where 1 is black)
 */
export function darkenColor(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

/**
 * Get color styles from a hex color for badges
 * Returns CSS style object with lightened background, darkened text, and border
 */
export function getBadgeStylesFromHex(hex: string): {
  backgroundColor: string;
  color: string;
  borderColor: string;
} {
  return {
    backgroundColor: lightenColor(hex, 0.7), // Very light background
    color: darkenColor(hex, 0.3), // Darker text for readability
    borderColor: lightenColor(hex, 0.4), // Medium border
  };
}

/**
 * Get waffle/chart background style from a hex color
 */
export function getWaffleStyleFromHex(hex: string): { backgroundColor: string } {
  return { backgroundColor: hex };
}

/**
 * Get component color classes based on AI assignment or fallback to gray.
 * Returns null if the color is a hex value (caller should use inline styles).
 */
export function getComponentColorClasses(
  component: string,
  componentColors?: Record<string, string>
): string | null {
  const colorValue = componentColors?.[component];
  if (colorValue) {
    // If it's a hex color, return null - caller should use inline styles
    if (isHexColor(colorValue)) {
      return null;
    }
    return colorNameToClasses[colorValue] ?? colorNameToClasses.gray!;
  }
  return colorNameToClasses.gray!;
}

/**
 * Get badge styles for a component. Returns either Tailwind classes or inline styles.
 */
export function getComponentBadgeStyles(
  component: string,
  componentColors?: Record<string, string>
): { classes: string | null; style: React.CSSProperties | null } {
  const colorValue = componentColors?.[component];
  if (colorValue) {
    if (isHexColor(colorValue)) {
      return {
        classes: null,
        style: getBadgeStylesFromHex(colorValue),
      };
    }
    return {
      classes: colorNameToClasses[colorValue] ?? colorNameToClasses.gray!,
      style: null,
    };
  }
  return {
    classes: colorNameToClasses.gray!,
    style: null,
  };
}

/**
 * Get component color hex code based on AI assignment or fallback to gray
 * For charts - returns the light background hex
 */
export function getComponentColorHex(
  component: string,
  componentColors?: Record<string, string>
): string {
  const colorValue = componentColors?.[component];
  if (colorValue) {
    // If it's already a hex color, lighten it for chart background
    if (isHexColor(colorValue)) {
      return lightenColor(colorValue, 0.7);
    }
    return colorNameToHex[colorValue] ?? colorNameToHex.gray!;
  }
  return colorNameToHex.gray!;
}

/**
 * Get component text color hex code based on AI assignment or fallback to gray
 */
export function getComponentTextColorHex(
  component: string,
  componentColors?: Record<string, string>
): string {
  const colorValue = componentColors?.[component];
  if (colorValue) {
    // If it's a hex color, darken it for text
    if (isHexColor(colorValue)) {
      return darkenColor(colorValue, 0.3);
    }
    return colorNameToTextHex[colorValue] ?? colorNameToTextHex.gray!;
  }
  return colorNameToTextHex.gray!;
}

/**
 * Get component background class for WaffleChart based on AI assignment or fallback to gray.
 * Returns null if the color is a hex value (caller should use inline styles).
 */
export function getComponentBgClass(
  component: string,
  componentColors?: Record<string, string>
): string | null {
  const colorValue = componentColors?.[component];
  if (colorValue) {
    // If it's a hex color, return null - caller should use inline styles
    if (isHexColor(colorValue)) {
      return null;
    }
    return colorNameToBgClass[colorValue] ?? colorNameToBgClass.gray!;
  }
  return colorNameToBgClass.gray!;
}

/**
 * Get waffle/chart background styles for a component.
 * Returns either Tailwind class or inline style object.
 */
export function getComponentWaffleStyles(
  component: string,
  componentColors?: Record<string, string>
): { classes: string | null; style: React.CSSProperties | null } {
  const colorValue = componentColors?.[component];
  if (colorValue) {
    if (isHexColor(colorValue)) {
      return {
        classes: null,
        style: getWaffleStyleFromHex(colorValue),
      };
    }
    return {
      classes: colorNameToBgClass[colorValue] ?? colorNameToBgClass.gray!,
      style: null,
    };
  }
  return {
    classes: colorNameToBgClass.gray!,
    style: null,
  };
}

/**
 * Get the raw waffle hex for a component (the main saturated color).
 * Used for charts and visualizations where we need the actual hex value.
 */
export function getComponentWaffleHex(
  component: string,
  componentColors?: Record<string, string>
): string {
  const colorValue = componentColors?.[component];
  if (colorValue) {
    // If it's already a hex color, return it directly
    if (isHexColor(colorValue)) {
      return colorValue;
    }
    return colorNameToWaffleHex[colorValue] ?? colorNameToWaffleHex.gray!;
  }
  return colorNameToWaffleHex.gray!;
}
