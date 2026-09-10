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
 * {@link ModalFrame}), portalled to `document.body`. Closes on Escape or backdrop click, moves focus
 * into the dialog on open, and restores focus to the previously focused element on close.
 */
export function RetroDialog({ children, className, labelledBy, onClose }: RetroDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

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
    document.body,
  );
}
