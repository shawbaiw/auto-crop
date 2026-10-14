import type { ReactNode } from "react";

/** A titled panel on a Workbench page (spec §3), the same material as an Execution Trace; its title is also its region name. */
export function WorkbenchSection({ children, icon, title }: { children: ReactNode; icon: ReactNode; title: string }) {
  return (
    <section
      aria-label={title}
      className="grid gap-4 rounded-[var(--r-panel)] border border-[color:var(--edge-highlight)] bg-[color:var(--surface-panel)] p-5 sm:p-6"
      role="region"
    >
      <h2 className="flex items-center gap-2 text-[17px] font-semibold normal-case [&_svg]:size-4 [&_svg]:text-muted-foreground">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}
