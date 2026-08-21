import { RetroStatus } from "../retro";
import type { ReactNode } from "react";

export type PageHeaderProps = {
  eyebrow: string;
  status: string;
  statusIcon?: ReactNode;
  title: string;
  titleId?: string;
};

export function PageHeader({ eyebrow, status, statusIcon, title, titleId }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1 id={titleId}>{title}</h1>
      </div>
      <RetroStatus icon={statusIcon}>{status}</RetroStatus>
    </header>
  );
}
