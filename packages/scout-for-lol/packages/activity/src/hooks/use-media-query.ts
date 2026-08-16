import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => globalThis.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = globalThis.matchMedia(query);
    const update = () => {
      setMatches(media.matches);
    };
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, [query]);
  return matches;
}
