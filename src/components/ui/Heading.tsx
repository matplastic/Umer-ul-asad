import { createElement } from "react";
import type { HTMLAttributes, ReactNode } from "react";

/**
 * Semantic size, independent of the HTML tag rendered. This lets a
 * portal use "level 2 look" inside an <h1> context, or vice versa,
 * without fighting the component API.
 */
type Level = 1 | 2 | 3 | 4 | "eyebrow";

interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  level?: Level;
  /** HTML tag to render. Defaults to a sensible tag per level. */
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span";
  /** Optional small label rendered above the heading (e.g. "QUALITY CONTROL"). */
  eyebrow?: ReactNode;
  /** Optional supporting line rendered below the heading. */
  subtitle?: ReactNode;
  className?: string;
  children?: ReactNode;
}

const DEFAULT_TAG: Record<Level, HeadingProps["as"]> = {
  1: "h1",
  2: "h2",
  3: "h3",
  4: "h4",
  eyebrow: "span",
};

/**
 * Size/weight/tracking per level. Uses the same semantic tokens as the
 * rest of the design system (font-display for the big titles, font-sans
 * for body-adjacent headings) so headings stop being re-invented per
 * screen (text-sm font-black, text-lg font-black uppercase, etc.).
 *
 *   1 -> Page title           e.g. "Quality Control Dashboard"
 *   2 -> Section title        e.g. "Pending Approvals"
 *   3 -> Card / panel title   e.g. "Enter Your Team Code"
 *   4 -> Minor sub-heading    e.g. small bold labels inside a card
 *   eyebrow -> Tiny uppercase kicker label above a level 1/2 heading
 */
const LEVEL_CLASSES: Record<Level, string> = {
  1: "font-display text-2xl md:text-3xl font-bold tracking-tight text-neutral-900",
  2: "font-display text-xl md:text-2xl font-semibold tracking-tight text-neutral-900",
  3: "font-sans text-base md:text-lg font-semibold tracking-tight text-neutral-900",
  4: "font-sans text-sm font-semibold tracking-tight text-neutral-800",
  eyebrow:
    "font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-primary-600",
};

const SUBTITLE_CLASSES = "mt-1 font-sans text-sm font-normal text-neutral-500";

/**
 * Shared heading primitive. Replaces one-off `<h1>`/`<h2>`/`<h3>` +
 * hand-picked size/weight/tracking combinations across portals.
 *
 * Usage:
 *   <Heading level={1} eyebrow="Quality Control" subtitle="Umm Al Quwain plant">
 *     Trial Report Dashboard
 *   </Heading>
 *
 *   <Heading level={3}>Enter Your Team Code</Heading>
 *
 *   // Render level-2 styling but keep it an <h1> for a11y/SEO reasons:
 *   <Heading level={2} as="h1">Daily Stage-wise Progress</Heading>
 */
export default function Heading({
  level = 2,
  as,
  eyebrow,
  subtitle,
  className = "",
  children,
  ...rest
}: HeadingProps) {
  const tag = as ?? DEFAULT_TAG[level] ?? "h2";

  if (level === "eyebrow") {
    return createElement(
      tag,
      { className: [LEVEL_CLASSES.eyebrow, className].join(" "), ...rest },
      children
    );
  }

  return createElement(
    "div",
    { className: "flex flex-col" },
    eyebrow && (
      <span className={LEVEL_CLASSES.eyebrow}>{eyebrow}</span>
    ),
    createElement(
      tag,
      { className: [LEVEL_CLASSES[level], eyebrow ? "mt-1" : "", className].join(" "), ...rest },
      children
    ),
    subtitle && <p className={SUBTITLE_CLASSES}>{subtitle}</p>
  );
}
