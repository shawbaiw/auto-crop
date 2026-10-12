import * as React from "react";
import { Textarea, type TextareaProps } from "@/components/ui";
import { cn } from "@/lib/utils";

export type ComposerInputProps = TextareaProps;

/** The founder's natural-language input: a soft, raised surface rather than a plain form field. */
export const ComposerInput = React.forwardRef<HTMLTextAreaElement, ComposerInputProps>(({ className, ...props }, ref) => (
  <Textarea
    className={cn(
      "min-h-36 resize-y rounded-xl border-border/70 bg-card/80 px-4 py-3 text-base leading-relaxed shadow-workbench backdrop-blur",
      className,
    )}
    ref={ref}
    {...props}
  />
));
ComposerInput.displayName = "ComposerInput";
