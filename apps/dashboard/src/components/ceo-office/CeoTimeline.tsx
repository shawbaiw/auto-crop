import { ArrowDown } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CeoOfficeItemSummary } from "../../api/client";
import { Button } from "@/components/ui";
import { useLanguage } from "../../ui/language";
import { CeoOfficeCard, type CeoOfficeView } from "./CeoOfficeCard";

type DayGroup = { key: string; label: string; items: CeoOfficeItemSummary[] };

/**
 * The CEO Office Timeline: today's items, newest at the bottom beside the composer. Earlier days fold
 * into one line each and open on demand. When nothing happened today, the latest day stays open, so
 * the founder never lands on an empty page. The view follows new items while the founder is at the
 * bottom, and offers a jump back down when they have scrolled up to read.
 */
export function CeoTimeline({ companyId, items, view }: { companyId: string; items: CeoOfficeItemSummary[]; view: CeoOfficeView }) {
  const { language, t } = useLanguage();
  const groups = groupByDay(items, language);
  const historyRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const [hasNewItems, setHasNewItems] = useState(false);
  const revision = items.map((item) => `${item.id}:${item.actionBearing}`).join("|");

  const scrollToLatest = () => {
    const history = historyRef.current;
    if (history) history.scrollTop = history.scrollHeight;
    followLatest.current = true;
    setHasNewItems(false);
  };
  useLayoutEffect(() => {
    followLatest.current = true;
    scrollToLatest();
  }, [companyId]);
  useLayoutEffect(() => {
    if (followLatest.current) scrollToLatest();
    else setHasNewItems(true);
  }, [revision]);
  useEffect(() => {
    const history = historyRef.current;
    if (!history || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (followLatest.current) history.scrollTop = history.scrollHeight;
    });
    observer.observe(history);
    if (history.firstElementChild) observer.observe(history.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative h-full min-h-0">
      <div
        aria-label={t("ceoOffice.timeline")}
        className="h-full overflow-y-auto overscroll-contain pr-1"
        onScroll={() => {
          const history = historyRef.current;
          if (!history) return;
          followLatest.current = history.scrollHeight - history.scrollTop - history.clientHeight < 48;
          if (followLatest.current) setHasNewItems(false);
        }}
        ref={historyRef}
        role="region"
        tabIndex={0}
      >
        <div className="grid content-end gap-4 pb-2">
          {groups.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{t("ceoOffice.timelineEmpty")}</p> : null}
          {groups.map((group, index) =>
            index === groups.length - 1 ? (
              <section aria-label={group.label} className="grid gap-4" key={group.key}>
                <h3 className="text-center text-[13px] font-medium normal-case text-muted-foreground">{group.label}</h3>
                {group.items.map((item) => (
                  <CeoOfficeCard item={item} key={item.id} view={view} />
                ))}
              </section>
            ) : (
              <details className="group grid gap-4" key={group.key}>
                <summary className="mx-auto w-fit cursor-pointer list-none rounded-[var(--r-pill)] px-3 py-1 text-center text-[13px] font-medium text-muted-foreground transition-colors hover:bg-[color:var(--c-warm)] hover:text-foreground focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none">
                  {t("ceoOffice.earlierDay").replace("{date}", group.label).replace("{count}", String(group.items.length))}
                </summary>
                <div className="mt-4 grid gap-4">
                  {group.items.map((item) => (
                    <CeoOfficeCard item={item} key={item.id} view={view} />
                  ))}
                </div>
              </details>
            ),
          )}
        </div>
      </div>
      {hasNewItems ? (
        <Button className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-[var(--r-pill)] shadow-[var(--shadow-panel)]" onClick={scrollToLatest} size="sm">
          <ArrowDown aria-hidden="true" />
          {t("ceoOffice.newUpdates")}
        </Button>
      ) : null}
    </div>
  );
}

/** Items by local calendar day, oldest day first. Items arrive sorted oldest first. */
function groupByDay(items: CeoOfficeItemSummary[], language: "en" | "zh"): DayGroup[] {
  const groups: DayGroup[] = [];
  const today = new Date().toDateString();
  const formatter = new Intl.DateTimeFormat(language, { month: "short", day: "numeric", year: "numeric" });
  const todayWord = new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(0, "day");
  const todayLabel = todayWord.charAt(0).toUpperCase() + todayWord.slice(1);
  for (const item of items) {
    const date = new Date(item.occurredAt);
    const key = date.toDateString();
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.items.push(item);
    } else {
      groups.push({ key, label: key === today ? todayLabel : formatter.format(date), items: [item] });
    }
  }
  return groups;
}
