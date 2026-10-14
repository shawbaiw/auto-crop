import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Ice Mist buttons (color system v2 §5.2): every size is a capsule. The small sizes keep their visual
 * height for dense rows; an invisible ::before stretches each hit area to at least 44px (spec §6).
 */
const buttonVariants = cva(
  "relative inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--r-pill)] px-4 py-2 text-sm font-medium normal-case tracking-normal transition-colors before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:pointer-events-none disabled:border disabled:border-[color:var(--edge-input)] disabled:bg-[color:var(--surface-input)] disabled:text-[color:var(--text-disabled)] disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[color:color-mix(in_srgb,var(--c-charcoal)_88%,var(--text-on-dark))]",
        // The final confirm of a destructive action; its entry point is an outlined danger action.
        destructive: "bg-destructive text-destructive-foreground hover:bg-[color:var(--danger-solid-hover)]",
        // The entry point of a destructive action: terracotta outline, filled only on hover.
        danger: "border border-[color:color-mix(in_srgb,var(--status-failed-fg)_45%,transparent)] bg-transparent text-status-failed hover:bg-status-failed-bg",
        outline: "border border-edge-strong bg-[color:var(--surface-input)] text-foreground hover:bg-[color:var(--c-warm)]",
        secondary: "border border-edge-strong bg-[color:var(--surface-input)] text-foreground hover:bg-[color:var(--c-warm)]",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground disabled:border-transparent disabled:bg-transparent",
        link: "h-auto px-0 py-0 text-foreground underline underline-offset-4 hover:text-status-running disabled:border-transparent disabled:bg-transparent",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3.5 text-xs before:-inset-y-1.5",
        lg: "h-11 px-6 before:inset-y-0",
        icon: "size-9 p-0 before:-inset-x-1",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} type={type} {...props} />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
