import { useEffect, useState } from "react";

/** Whether a media query matches now, following changes. Without `matchMedia` (tests), the wide layout. */
export function useMediaQuery(query: string): boolean {
  const read = () => (typeof window === "undefined" || typeof window.matchMedia !== "function" ? true : window.matchMedia(query).matches);
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
