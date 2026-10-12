import type { ReactNode } from "react";
import { Card } from "@/components/ui";

/** A titled card on a Workbench page; its title is also its region name. */
export function WorkbenchSection({ children, icon, title }: { children: ReactNode; icon: ReactNode; title: string }) {
  return (
    <Card aria-label={title} className="grid gap-3 p-4 sm:p-5" role="region">
      <h2 className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-4 [&_svg]:text-muted-foreground">
        {icon}
        {title}
      </h2>
      {children}
    </Card>
  );
}
