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
  // Extended colors for workflow phases preset
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
  // Extended colors for workflow phases preset
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
  // Extended colors for workflow phases preset
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
  orange: "#c2410c", // orange-700
  emerald: "#047857", // emerald-700
  purple: "#7e22ce", // purple-700
  blue: "#1d4ed8", // blue-700
  slate: "#334155", // slate-700
  indigo: "#4338ca", // indigo-700
  gray: "#374151", // gray-700
  // Extended colors for workflow phases preset
  cyan: "#0e7490", // cyan-700
  teal: "#0f766e", // teal-700
  rose: "#be123c", // rose-700
  amber: "#b45309", // amber-700
  violet: "#6d28d9", // violet-700
  lime: "#4d7c0f", // lime-700
  sky: "#0369a1", // sky-700
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

/**
 * Get component background class for WaffleChart based on AI assignment or fallback to gray
 */
export function getComponentBgClass(
  component: string,
  componentColors?: Record<string, string>
): string {
  // If colors are assigned, use them
  if (componentColors && componentColors[component]) {
    const colorName = componentColors[component];
    return colorNameToBgClass[colorName] || colorNameToBgClass.gray;
  }

  // Default to gray (used while waiting for AI to assign colors)
  return colorNameToBgClass.gray;
}
