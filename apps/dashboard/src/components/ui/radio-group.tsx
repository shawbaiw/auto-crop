import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "@/lib/utils";

export const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => <RadioGroupPrimitive.Root className={cn("grid gap-2", className)} ref={ref} {...props} />);
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

export const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    className={cn(
      "aspect-square size-4 shrink-0 rounded-[var(--r-pill)] border border-edge-strong bg-[color:var(--surface-input)] text-foreground focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none data-[state=checked]:border-[color:var(--c-charcoal)] disabled:cursor-not-allowed disabled:border-[color:var(--edge-input)] disabled:bg-[color:var(--c-mist)]",
      className,
    )}
    ref={ref}
    {...props}
  >
    <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
      <span className="size-2 rounded-[var(--r-pill)] bg-[color:var(--c-charcoal)]" />
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;
