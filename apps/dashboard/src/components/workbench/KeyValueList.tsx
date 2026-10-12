import { cn } from "@/lib/utils";

export type KeyValueItem = { label: string; value: string };

/** Label and value pairs, two columns where there is room. */
export function KeyValueList({ className, items }: { className?: string; items: KeyValueItem[] }) {
  return (
    <dl className={cn("grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(8rem,auto)_minmax(0,1fr)]", className)}>
      {items.map((item) => (
        <div className="contents" key={item.label}>
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="m-0 min-w-0 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A plain list of lines, or a quiet message when there are none. */
export function LineList({ emptyMessage, lines }: { emptyMessage: string; lines: string[] }) {
  if (lines.length === 0) {
    return emptyMessage ? <p className="text-sm text-muted-foreground">{emptyMessage}</p> : null;
  }
  return (
    <ul className="grid gap-1 text-sm">
      {lines.map((line, index) => (
        <li className="break-words" key={`${index}:${line}`}>
          {line}
        </li>
      ))}
    </ul>
  );
}
