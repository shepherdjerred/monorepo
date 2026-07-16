import { useEffect, useState } from "react";

/**
 * Debounce a rapidly-changing value (e.g. a typeahead search query) so
 * downstream queries only fire after the user pauses.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);
  return debounced;
}
