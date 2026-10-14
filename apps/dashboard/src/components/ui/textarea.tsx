import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      "flex min-h-24 w-full rounded-[var(--r-textarea)] px-3 py-2 border border-edge-strong bg-[color:var(--surface-input)] text-sm text-foreground transition-colors placeholder:text-muted-foreground hover:border-[color:var(--text-secondary)] focus-visible:border-[color:var(--c-charcoal)] focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none aria-[invalid=true]:border-status-failed disabled:cursor-not-allowed disabled:border-[color:var(--edge-input)] disabled:bg-[color:var(--c-mist)] disabled:text-[color:var(--text-disabled)]",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = "Textarea";
