/**
 * Color definitions for static componentisation
 *
 * Uses role-based colors matching the conversation view:
 * - system: blue
 * - user: green
 * - assistant: amber
 * - tool: purple
 *
 * Part types within a role use different shades/hues.
 */

// Static component color mapping
// Format: "role.partType" → tailwind color class
const staticComponentColors: Record<string, string> = {
  // System role (blue shades)
  "system.text": "bg-blue-400",

  // User role (green shades)
  "user.text": "bg-green-300",
  "user.image": "bg-green-500",
  "user.file": "bg-green-700",

  // Assistant role (amber shades)
  "assistant.text": "bg-amber-300",
  "assistant.reasoning": "bg-amber-400",
  "assistant.tool-call": "bg-amber-600",

  // Tool role (purple shades)
  "tool.tool-result": "bg-purple-400",
};

// Hex colors for charts (matching the Tailwind classes above)
const staticComponentHexColors: Record<string, string> = {
  // System role (blue shades)
  "system.text": "#60a5fa", // blue-400

  // User role (green shades)
  "user.text": "#86efac", // green-300
  "user.image": "#22c55e", // green-500
  "user.file": "#15803d", // green-700

  // Assistant role (amber shades)
  "assistant.text": "#fcd34d", // amber-300
  "assistant.reasoning": "#fbbf24", // amber-400
  "assistant.tool-call": "#d97706", // amber-600

  // Tool role (purple shades)
  "tool.tool-result": "#c084fc", // purple-400
};

// Text colors for contrast on colored backgrounds
const staticComponentTextColors: Record<string, string> = {
  // System role
  "system.text": "text-blue-900",

  // User role
  "user.text": "text-green-900",
  "user.image": "text-white",
  "user.file": "text-white",

  // Assistant role
  "assistant.text": "text-amber-900",
  "assistant.reasoning": "text-amber-900",
  "assistant.tool-call": "text-white",

  // Tool role
  "tool.tool-result": "text-purple-900",
};

// Default fallback colors
const defaultBgColor = "bg-gray-400";
const defaultHexColor = "#9ca3af"; // gray-400
const defaultTextColor = "text-gray-900";

/**
 * Get Tailwind background class for a static component
 */
export function getStaticComponentBgClass(component: string): string {
  return staticComponentColors[component] || defaultBgColor;
}

/**
 * Get hex color for a static component (for charts)
 */
export function getStaticComponentHexColor(component: string): string {
  return staticComponentHexColors[component] || defaultHexColor;
}

/**
 * Get text color class for a static component
 */
export function getStaticComponentTextClass(component: string): string {
  return staticComponentTextColors[component] || defaultTextColor;
}

/**
 * Get both bg and text classes combined
 */
export function getStaticComponentClasses(component: string): string {
  return `${getStaticComponentBgClass(component)} ${getStaticComponentTextClass(component)}`;
}

/**
 * Get waffle/chart background styles for a static component.
 * Returns the Tailwind class and null style (static components always use Tailwind classes).
 */
export function getStaticComponentWaffleStyles(component: string): {
  classes: string | null;
  style: React.CSSProperties | null;
} {
  return {
    classes: staticComponentColors[component] ?? defaultBgColor,
    style: null,
  };
}

/**
 * Get display label for a static component
 * Converts "user.tool-call" to "User > Tool Call"
 */
export function getStaticComponentLabel(component: string): string {
  return component
    .split(".")
    .map((part) =>
      part
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    )
    .join(" > ");
}
