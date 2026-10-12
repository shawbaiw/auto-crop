import * as React from "react";
import { cn } from "@/lib/utils";

/** Shared by Card and by semantic surfaces (aside, main) that cannot render a div. */
export const cardClassName = "rounded-lg border border-border/80 bg-card text-card-foreground shadow-workbench";

export type CardProps = React.HTMLAttributes<HTMLDivElement>;

export const Card = React.forwardRef<HTMLDivElement, CardProps>(({ className, ...props }, ref) => (
  <div
    className={cn(cardClassName, className)}
    ref={ref}
    {...props}
  />
));
Card.displayName = "Card";
