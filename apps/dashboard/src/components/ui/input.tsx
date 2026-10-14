import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    className={cn(
      "flex h-9 w-full rounded-[var(--r-pill)] px-4 py-1 file:border-0 file:bg-transparent file:text-sm file:font-medium border border-edge-strong bg-[color:var(--surface-input)] text-sm text-foreground transition-colors placeholder:text-muted-foreground hover:border-[color:var(--text-secondary)] focus-visible:border-[color:var(--c-charcoal)] focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none aria-[invalid=true]:border-status-failed disabled:cursor-not-allowed disabled:border-[color:var(--edge-input)] disabled:bg-[color:var(--c-mist)] disabled:text-[color:var(--text-disabled)]",
      className,
    )}
    ref={ref}
    type={type}
    {...props}
  />
));
Input.displayName = "Input";
