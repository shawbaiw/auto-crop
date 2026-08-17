import type { ButtonHTMLAttributes, ReactNode } from "react";

export type RetroButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  variant?: "primary" | "secondary" | "danger";
};

export function RetroButton({ children, className, icon, variant = "secondary", ...props }: RetroButtonProps) {
  const classes = ["retro-button", `retro-button--${variant}`, className].filter(Boolean).join(" ");

  return (
    <button className={classes} type="button" {...props}>
      {icon ? <span className="retro-button__icon">{icon}</span> : null}
      <span>{children}</span>
    </button>
  );
}
