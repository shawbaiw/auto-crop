import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium normal-case tracking-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:border disabled:border-[color:var(--edge-input)] disabled:bg-[color:var(--surface-input)] disabled:text-[color:var(--text-disabled)] disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[color:color-mix(in_srgb,var(--c-charcoal)_88%,var(--text-on-dark))]",
        // The final confirm of a destructive action; its entry point is an outlined danger action.
        destructive: "bg-destructive text-destructive-foreground hover:bg-[color:var(--danger-solid-hover)]",
        outline: "border border-edge-strong bg-[color:var(--surface-input)] text-foreground hover:bg-[color:var(--c-warm)]",
        secondary: "border border-edge-strong bg-[color:var(--surface-input)] text-foreground hover:bg-[color:var(--c-warm)]",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground disabled:border-transparent disabled:bg-transparent",
        link: "h-auto px-0 py-0 text-foreground underline underline-offset-4 hover:text-status-running disabled:border-transparent disabled:bg-transparent",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-6",
        icon: "size-9 p-0",
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
