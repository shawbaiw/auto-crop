/**
 * Per-company "last visit" timestamp for the CEO Office Outcomes view, kept client-side only
 * (ADR 0018: no server-side "seen" tracking for a single-founder convenience).
 *
 * Every access is wrapped so a private window, cleared storage, or a `localStorage` getter that
 * throws degrades to "nothing is new" rather than erroring — a read failure returns `null` (which
 * every caller treats as "nothing new") and a write failure is swallowed.
 */

const KEY_PREFIX = "auto-crop.ceoOutcomesLastSeen.";

function outcomesLastSeenStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The stored ISO timestamp of the founder's last visit to this company's Outcomes view, or `null`. */
export function readOutcomesLastSeen(companyId: string): string | null {
  try {
    const storage = outcomesLastSeenStorage();
    return storage ? storage.getItem(`${KEY_PREFIX}${companyId}`) : null;
  } catch {
    return null;
  }
}

/** Record the founder's visit to this company's Outcomes view. Best-effort; failures are silent. */
export function writeOutcomesLastSeen(companyId: string, iso: string): void {
  try {
    outcomesLastSeenStorage()?.setItem(`${KEY_PREFIX}${companyId}`, iso);
  } catch {
    // A private window / cleared storage / throwing setter degrades to "nothing new".
  }
}

/**
 * Whether a record created at `iso` is newer than the founder's last visit. ISO timestamps compare
 * lexicographically, matching the backend's ordering. A missing `iso` or `lastSeen` is "not new" —
 * the first visit never marks everything unseen.
 */
export function isUnseenSince(iso: string | null | undefined, lastSeen: string | null): boolean {
  return Boolean(iso && lastSeen && iso.localeCompare(lastSeen) > 0);
}
