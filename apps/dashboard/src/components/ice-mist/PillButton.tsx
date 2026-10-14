import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type PillButtonVariant = "primary" | "secondary" | "danger";

export interface PillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PillButtonVariant;
}

/** A 44px capsule button. Primary is charcoal; danger is an outlined, quieter destructive action (spec §2). */
export const PillButton = forwardRef<HTMLButtonElement, PillButtonProps>(
  ({ className, type = "button", variant = "secondary", ...props }, ref) => (
    <button className={cn("im-pill", className)} data-variant={variant} ref={ref} type={type} {...props} />
  ),
);
PillButton.displayName = "PillButton";
