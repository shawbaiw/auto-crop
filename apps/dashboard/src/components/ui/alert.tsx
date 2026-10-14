import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** One-line notices in a state's colors (color system v2 §5.4); the icon says which kind. */
const alertVariants = cva("flex items-start gap-2 rounded-[var(--r-reading)] border px-3 py-3 text-sm", {
  variants: {
    variant: {
      info: "border-status-running-border bg-status-running-bg text-status-running",
      success: "border-status-success-border bg-status-success-bg text-status-success",
      caution: "border-status-caution-border bg-status-caution-bg text-status-caution",
      danger: "border-status-failed-border bg-status-failed-bg text-status-failed",
    },
  },
  defaultVariants: {
    variant: "info",
  },
});

const alertIcons: Record<NonNullable<AlertProps["variant"]>, { icon: LucideIcon; color: string }> = {
  info: { icon: Info, color: "text-status-running-icon" },
  success: { icon: CircleCheck, color: "text-status-success-icon" },
  caution: { icon: TriangleAlert, color: "text-status-caution-icon" },
  danger: { icon: CircleAlert, color: "text-status-failed-icon" },
};

export type AlertProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>;

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(({ children, className, variant, ...props }, ref) => {
  const { icon: Icon, color } = alertIcons[variant ?? "info"];
  return (
    <div className={cn(alertVariants({ variant }), className)} ref={ref} {...props}>
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", color)} />
      <div className="grid min-w-0 flex-1 gap-1">{children}</div>
    </div>
  );
});
Alert.displayName = "Alert";

export const AlertTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div className={cn("font-medium", className)} ref={ref} {...props} />,
);
AlertTitle.displayName = "AlertTitle";

export const AlertDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div className={cn("break-words", className)} ref={ref} {...props} />,
);
AlertDescription.displayName = "AlertDescription";
