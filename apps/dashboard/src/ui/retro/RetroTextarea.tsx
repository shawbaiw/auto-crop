import type { TextareaHTMLAttributes } from "react";

export type RetroTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function RetroTextarea(props: RetroTextareaProps) {
  return <textarea className="retro-textarea" {...props} />;
}
