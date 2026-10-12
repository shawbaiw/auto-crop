import { cn } from "@/lib/utils";

export type CreationTimelineProps = {
  /** Stages reported by the server, oldest first; the last one is where creation is now. */
  stages: string[];
  /** Shown, without any progress marked, until the server reports its first stage. */
  expectedStages: string[];
  isFailed: boolean;
};

export function CreationTimeline({ expectedStages, isFailed, stages }: CreationTimelineProps) {
  const reported = stages.length > 0;
  const rows = reported ? stages : expectedStages;

  return (
    <ol className="grid gap-0">
      {rows.map((stage, index) => {
        const isLast = index === rows.length - 1;
        const state = !reported ? "expected" : !isLast ? "done" : isFailed ? "failed" : "current";

        return (
          <li className="relative grid grid-cols-[1rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0" key={`${index}-${stage}`}>
            {!isLast ? <span aria-hidden="true" className="absolute left-[7px] top-4 h-full w-px bg-border" /> : null}
            <span
              aria-hidden="true"
              className={cn(
                "relative mt-1 size-3.5 rounded-full border-2",
                state === "expected" && "border-border bg-background",
                state === "done" && "border-primary bg-primary",
                state === "current" && "border-ring bg-background motion-safe:animate-pulse",
                state === "failed" && "border-destructive bg-destructive",
              )}
            />
            <span
              className={cn(
                "break-words text-sm",
                state === "expected" && "text-muted-foreground",
                state === "done" && "text-foreground",
                state === "current" && "font-medium text-foreground",
                state === "failed" && "font-medium text-destructive",
              )}
            >
              {stage}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
