import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    // A capsule of choices on a warm panel; the chosen one is cool blue, as the rail's current page is.
    className={cn("inline-flex h-11 items-center gap-1 rounded-[var(--r-pill)] border border-[color:var(--edge-highlight)] bg-[color:var(--surface-panel)] p-1 text-muted-foreground", className)}
    ref={ref}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    className={cn(
      "relative inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--r-pill)] px-4 text-sm font-medium transition-colors before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:bg-[color:var(--c-ice)] hover:text-foreground focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:pointer-events-none disabled:text-[color:var(--text-disabled)] data-[state=active]:bg-selected data-[state=active]:font-semibold data-[state=active]:text-foreground",
      className,
    )}
    ref={ref}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content className={cn("focus-visible:outline-none", className)} ref={ref} {...props} />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
