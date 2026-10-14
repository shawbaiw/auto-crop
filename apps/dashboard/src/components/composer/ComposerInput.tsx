import * as React from "react";
import { Textarea, type TextareaProps } from "@/components/ui";
import { cn } from "@/lib/utils";

export type ComposerInputProps = TextareaProps;

/** The founder's natural-language input: a multi-line Ice Mist field that grows, never a capsule (spec §2). */
export const ComposerInput = React.forwardRef<HTMLTextAreaElement, ComposerInputProps>(({ className, ...props }, ref) => (
  <Textarea
    className={cn(
      "min-h-36 resize-y rounded-[var(--r-textarea)] px-4 py-3 text-base leading-relaxed",
      className,
    )}
    ref={ref}
    {...props}
  />
));
ComposerInput.displayName = "ComposerInput";
