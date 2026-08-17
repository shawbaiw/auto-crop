import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export type RetroSelectOption = {
  label: string;
  value: string;
};

export type RetroSelectProps = {
  className?: string;
  disabled?: boolean;
  id?: string;
  label: string;
  onValueChange(value: string): void;
  options: RetroSelectOption[];
  value: string;
};

export function RetroSelect({ className, disabled = false, id, label, onValueChange, options, value }: RetroSelectProps) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const listboxId = `${triggerId}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)));
  const rootRef = useRef<HTMLSpanElement>(null);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];
  const classes = ["retro-select", className].filter(Boolean).join(" ");

  useEffect(() => {
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
  }, [options, value]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function selectOption(nextValue: string) {
    onValueChange(nextValue);
    setOpen(false);
  }

  function moveActive(delta: number) {
    setActiveIndex((current) => {
      const optionCount = options.length;
      if (optionCount === 0) {
        return 0;
      }
      return (current + delta + optionCount) % optionCount;
    });
  }

  return (
    <span className={classes} ref={rootRef}>
      <button
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className="retro-select-trigger"
        disabled={disabled}
        id={triggerId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            moveActive(1);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            moveActive(-1);
            return;
          }
          if (event.key === "Enter" && open) {
            event.preventDefault();
            selectOption(options[activeIndex]?.value ?? value);
          }
        }}
        type="button"
      >
        <span>{selectedOption?.label ?? "Select"}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="retro-select-popover" id={listboxId} role="listbox">
          {options.map((option, index) => (
            <button
              aria-selected={option.value === value}
              className={option.value === value || index === activeIndex ? "retro-option is-active" : "retro-option"}
              key={option.value}
              onClick={() => selectOption(option.value)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
