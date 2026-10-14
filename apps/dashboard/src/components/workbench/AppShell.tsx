import type { ReactNode } from "react";
import { cardClassName } from "@/components/ui";
import { cn } from "@/lib/utils";

export type ModernAppShellProps = {
  children: ReactNode;
  className?: string;
  header?: ReactNode;
  sidebar?: ReactNode;
  footer?: ReactNode;
  surface?: "plain" | "panel";
};

export function ModernAppShell({
  children,
  className,
  footer,
  header,
  sidebar,
  surface = "plain",
}: ModernAppShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen w-full grid-rows-[auto_minmax(0,1fr)_auto] px-4 py-4 font-sans sm:px-6 lg:px-8">
        {header ? <header className="z-10 border-b border-border/70 py-3">{header}</header> : null}
        <div className={cn("grid min-h-0 gap-5 py-5", sidebar ? "lg:grid-cols-[280px_minmax(0,1fr)]" : "grid-cols-1")}>
          {sidebar ? <aside className={cn(cardClassName, "min-h-0 p-3")}>{sidebar}</aside> : null}
          <main
            className={cn(
              "min-w-0",
              surface === "panel" && cn(cardClassName, "p-4 sm:p-6"),
              className,
            )}
          >
            {children}
          </main>
        </div>
        {footer ? <footer className="border-t border-border/70 py-3 text-sm text-muted-foreground">{footer}</footer> : null}
      </div>
    </div>
  );
}
