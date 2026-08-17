import type { ReactNode } from "react";

export type RetroFieldProps = {
  children: ReactNode;
  htmlFor?: string;
  label: string;
};

export function RetroField({ children, htmlFor, label }: RetroFieldProps) {
  return (
    <label className="retro-field" htmlFor={htmlFor}>
      <span>{label}</span>
      {children}
    </label>
  );
}
