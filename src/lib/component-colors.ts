/**
 * Shared color utilities for components across different views
 */

// Map color names to Tailwind CSS classes
export const colorNameToClasses: Record<string, string> = {
  orange: "bg-orange-100 text-orange-700 border-orange-300",
  emerald: "bg-emerald-100 text-emerald-700 border-emerald-300",
  purple: "bg-purple-100 text-purple-700 border-purple-300",
  blue: "bg-blue-100 text-blue-700 border-blue-300",
  slate: "bg-slate-100 text-slate-700 border-slate-300",
  indigo: "bg-indigo-100 text-indigo-700 border-indigo-300",
  gray: "bg-gray-100 text-gray-700 border-gray-300",
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
};

// Map color names to hex codes for text/labels (darker for readability)
export const colorNameToTextHex: Record<string, string> = {
  orange: "#c2410c", // orange-700
  emerald: "#047857", // emerald-700
  purple: "#7e22ce", // purple-700
  blue: "#1d4ed8", // blue-700
  slate: "#334155", // slate-700
  indigo: "#4338ca", // indigo-700
  gray: "#374151", // gray-700
};

/**
 * Get component color classes based on AI assignment or fallback to gray
 */
export function getComponentColorClasses(
  component: string,
  componentColors?: Record<string, string>
): string {
  // If colors are assigned, use them
  if (componentColors && componentColors[component]) {
    const colorName = componentColors[component];
    return colorNameToClasses[colorName] || colorNameToClasses.gray;
  }

  // Default to gray (used while waiting for AI to assign colors)
  return colorNameToClasses.gray;
}

/**
 * Get component color hex code based on AI assignment or fallback to gray
 */
export function getComponentColorHex(
  component: string,
  componentColors?: Record<string, string>
): string {
  // If colors are assigned, use them
  if (componentColors && componentColors[component]) {
    const colorName = componentColors[component];
    return colorNameToHex[colorName] || colorNameToHex.gray;
  }

  // Default to gray (used while waiting for AI to assign colors)
  return colorNameToHex.gray;
}

/**
 * Get component text color hex code based on AI assignment or fallback to gray
 */
export function getComponentTextColorHex(
  component: string,
  componentColors?: Record<string, string>
): string {
  // If colors are assigned, use them
  if (componentColors && componentColors[component]) {
    const colorName = componentColors[component];
    return colorNameToTextHex[colorName] || colorNameToTextHex.gray;
  }

  // Default to gray (used while waiting for AI to assign colors)
  return colorNameToTextHex.gray;
}
