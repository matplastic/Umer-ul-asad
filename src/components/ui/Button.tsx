import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "outline" | "success" | "warning" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  iconPosition?: "left" | "right";
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-primary-600 text-white shadow-[var(--shadow-elevation-1)] hover:bg-primary-700 hover:shadow-[var(--shadow-elevation-2)] active:bg-primary-800 active:shadow-[var(--shadow-elevation-1)] focus-visible:ring-primary-300 disabled:bg-primary-300 disabled:shadow-none",
  secondary:
    "bg-white text-neutral-700 border border-neutral-200 shadow-[var(--shadow-elevation-1)] hover:bg-neutral-50 hover:border-neutral-300 active:bg-neutral-100 focus-visible:ring-neutral-300 disabled:text-neutral-300 disabled:bg-neutral-50 disabled:shadow-none",
  outline:
    "bg-transparent text-primary-700 border border-primary-200 hover:bg-primary-50 hover:border-primary-300 active:bg-primary-100 focus-visible:ring-primary-300 disabled:text-neutral-300 disabled:border-neutral-200",
  success:
    "bg-success-600 text-white shadow-[var(--shadow-elevation-1)] hover:bg-success-700 hover:shadow-[var(--shadow-elevation-2)] active:bg-success-800 active:shadow-[var(--shadow-elevation-1)] focus-visible:ring-success-300 disabled:bg-success-300 disabled:shadow-none",
  warning:
    "bg-warning-500 text-white shadow-[var(--shadow-elevation-1)] hover:bg-warning-600 hover:shadow-[var(--shadow-elevation-2)] active:bg-warning-700 active:shadow-[var(--shadow-elevation-1)] focus-visible:ring-warning-300 disabled:bg-warning-200 disabled:shadow-none",
  danger:
    "bg-danger-600 text-white shadow-[var(--shadow-elevation-1)] hover:bg-danger-700 hover:shadow-[var(--shadow-elevation-2)] active:bg-danger-800 active:shadow-[var(--shadow-elevation-1)] focus-visible:ring-danger-300 disabled:bg-danger-300 disabled:shadow-none",
  ghost:
    "bg-transparent text-neutral-600 hover:bg-neutral-100 active:bg-neutral-200 focus-visible:ring-neutral-300 disabled:text-neutral-300",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-[var(--radius-control)] tracking-tight",
  md: "h-10 px-4 text-sm gap-2 rounded-[var(--radius-control)] tracking-tight",
  lg: "h-12 px-5 text-base gap-2 rounded-[var(--radius-control)] tracking-tight",
};

const ICON_SIZE: Record<Size, string> = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-5 w-5",
};

/**
 * Shared button primitive. Replaces one-off `<button className="...">`
 * instances across portals so variant/size/state styling stays in one
 * place. Colors come from the semantic tokens in index.css
 * (primary/success/warning/danger/neutral) rather than raw palette
 * classes, so re-theming the app means editing tokens, not 19 files.
 *
 * Usage:
 *   <Button variant="primary" onClick={handleSave}>Save</Button>
 *   <Button variant="danger" size="sm" icon={<Trash2 />}>Delete</Button>
 *   <Button variant="secondary" loading>Submitting...</Button>
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      icon,
      iconPosition = "left",
      disabled,
      className = "",
      children,
      ...rest
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={[
          "inline-flex items-center justify-center font-sans font-semibold",
          "transition-[background-color,border-color,box-shadow,transform] duration-150 select-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
          "disabled:cursor-not-allowed active:scale-[0.98] disabled:active:scale-100",
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className,
        ].join(" ")}
        {...rest}
      >
        {loading ? (
          <Loader2 className={`${ICON_SIZE[size]} animate-spin`} />
        ) : (
          icon && iconPosition === "left" && (
            <span className={ICON_SIZE[size]}>{icon}</span>
          )
        )}
        {children && <span>{children}</span>}
        {!loading && icon && iconPosition === "right" && (
          <span className={ICON_SIZE[size]}>{icon}</span>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";

export default Button;
