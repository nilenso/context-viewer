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
// Format: "role.partType" -> tailwind color class
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

// Default fallback color
const defaultBgColor = "bg-gray-400";

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
