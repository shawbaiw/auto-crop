import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type RetroDialogProps = {
  children: ReactNode;
  className?: string;
  labelledBy: string;
  onClose: () => void;
};

/**
 * A page-level overlay dialog: a fixed backdrop over the current view (not a full-page swap like
 * {@link ModalFrame}). Closes on Escape or backdrop click, moves focus into the dialog on open, and
 * restores focus to the previously focused element on close.
 *
 * Portalled into `.theme-root` (the element `ThemeProvider` sets the palette CSS variables on), not
 * `document.body` — a body-level portal renders outside the theme scope, so `var(--surface)` /
 * `var(--ink)` and friends fail to resolve and the dialog paints with no background or backdrop.
 * `.theme-root` sits above the CRT geometry transform, so the fixed backdrop is still viewport-anchored.
 */
export function RetroDialog({ children, className, labelledBy, onClose }: RetroDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const portalTarget =
    (typeof document !== "undefined" && document.querySelector<HTMLElement>(".theme-root")) || null;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div className="retro-dialog-backdrop" onClick={onClose} role="presentation">
      <div
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={["retro-dialog", className].filter(Boolean).join(" ")}
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    portalTarget ?? document.body,
  );
}
