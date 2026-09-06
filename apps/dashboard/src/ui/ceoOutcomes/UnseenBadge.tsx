import { useLanguage } from "../language";
import { RetroBadge } from "../retro";
import { isUnseenSince } from "./lastSeen";

/**
 * A quiet "new" marker shown when `createdAt` is newer than the founder's last visit to the Outcomes
 * view. Renders nothing when the record is not newer (or when either timestamp is missing), so
 * callers can drop it in unconditionally next to a title or classification.
 */
export function UnseenBadge({
  createdAt,
  lastSeen,
}: {
  createdAt: string | null | undefined;
  lastSeen: string | null;
}) {
  const { t } = useLanguage();
  if (!isUnseenSince(createdAt, lastSeen)) {
    return null;
  }
  return <RetroBadge tone="signal">{t("department.unseenBadge")}</RetroBadge>;
}
