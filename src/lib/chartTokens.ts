/**
 * Chart color constants for Recharts/SVG props (stroke, fill, stopColor)
 * that must be literal color strings and can't use Tailwind classes.
 *
 * These values are kept in sync with the --color-* tokens in
 * src/index.css. If you update a brand color there, update it here too.
 */
export const chartTokens = {
  primary: {
    400: "#818cf8",
    500: "#6366f1",
    600: "#4f46e5",
    800: "#3730a3",
  },
  neutral: {
    100: "#f1f5f9",
    400: "#94a3b8",
    500: "#64748b",
    white: "#ffffff",
  },
  primaryTint: "#eff6ff",
} as const;

/** Common Recharts gridline/axis defaults, so every chart matches. */
export const chartAxisDefaults = {
  gridStroke: chartTokens.neutral[100],
  axisStroke: chartTokens.neutral[500],
  secondaryLineStroke: chartTokens.neutral[400],
  primaryLineStroke: chartTokens.primary[600],
};
