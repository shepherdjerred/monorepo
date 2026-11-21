import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { SuggestResponseSchema } from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import {
  apiRequest,
  apiUrl,
} from "@shepherdjerred/streambot/web/client/api.ts";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import "@shepherdjerred/streambot/web/client/styles/search.css";

const SUGGEST_DEBOUNCE_MS = 150;

/** Focuses the first result row, if the page shows any. */
function focusFirstRow(): boolean {
  const row = document.querySelector<HTMLElement>(
    '[data-row-scope="results"] [data-row]',
  );
  row?.focus();
  return row !== null;
}

/** The query in the address bar, so Back returns to earlier searches and Home is no query. */
export function useQuery(): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const query = location.pathname === "/" ? (params.get("q") ?? "") : "";
  return [
    query,
    (value) => {
      const next =
        value === "" ? "" : "?" + new URLSearchParams({ q: value }).toString();
      if (location.pathname === "/")
        setParams(value === "" ? {} : { q: value }, { replace: query !== "" });
      else void navigate("/" + next);
    },
  ];
}

/**
 * The remote's one search input: an ARIA combobox whose list holds typeahead suggestions.
 * Results themselves render in the page as the query changes; ArrowDown moves from the input
 * (or past the last suggestion) into them.
 */
export function SearchBox() {
  const remote = useRemote();
  const [query, setQuery] = useQuery();
  const [text, setText] = useState(query);
  const [suggestions, setSuggestions] = useState<readonly string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const catalog = remote.room?.capabilities.musicCatalog === true;

  useEffect(() => {
    setText(query);
  }, [query]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      if (
        event.key === "/" &&
        !(target instanceof HTMLInputElement) &&
        !(target instanceof HTMLTextAreaElement) &&
        !(target instanceof HTMLSelectElement)
      ) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const trimmed = text.trim();
    if (!catalog || trimmed === "" || /^https?:\/\//iu.test(trimmed)) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const load = async () => {
      const result = await apiRequest(
        apiUrl("/api/search/v2/suggest", {
          q: trimmed,
          guildId: remote.guildId,
        }),
        SuggestResponseSchema,
        { signal: controller.signal },
      );
      // Typeahead is a convenience: a failed suggestion request leaves the list empty.
      if (!controller.signal.aborted)
        setSuggestions(result.ok ? result.data.suggestions : []);
    };
    const timer = setTimeout(() => {
      void load();
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, catalog, remote.guildId]);

  const shown = open ? suggestions.filter((value) => value !== text) : [];
  const choose = (value: string) => {
    setText(value);
    setQuery(value);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (active + 1 < shown.length) {
        setOpen(true);
        setActive(active + 1);
      } else if (focusFirstRow()) setOpen(false);
    } else if (event.key === "ArrowUp" && shown.length > 0) {
      event.preventDefault();
      setActive(Math.max(-1, active - 1));
    } else if (event.key === "Enter") {
      const picked = shown[active];
      if (picked !== undefined) {
        event.preventDefault();
        choose(picked);
      }
    } else if (event.key === "Escape") {
      // Escape only closes the suggestion list. It never discards a typed query (a search
      // input would otherwise clear itself); the field's clear button does that.
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <form
      className="search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        setQuery(text);
        setOpen(false);
      }}
    >
      <label className="visually-hidden" htmlFor={listId + "-input"}>
        Search songs, shows, videos and live games, or paste a link
      </label>
      <span className="search-icon" aria-hidden="true">
        ⌕
      </span>
      <input
        ref={input}
        id={listId + "-input"}
        className="search-input"
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-activedescendant={
          active >= 0 ? listId + "-" + String(active) : undefined
        }
        autoComplete="off"
        spellCheck={false}
        placeholder="Songs, shows, videos, live games, or paste a link…"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setQuery(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
      />
      <kbd className="search-hint" aria-hidden="true">
        /
      </kbd>
      <ul
        id={listId}
        role="listbox"
        aria-label="Suggestions"
        className="suggestions"
        hidden={shown.length === 0}
      >
        {shown.map((value, index) => (
          <li
            key={value}
            id={listId + "-" + String(index)}
            role="option"
            aria-selected={index === active}
            className="suggestion"
            onPointerDown={(event) => {
              event.preventDefault();
              choose(value);
            }}
          >
            {value}
          </li>
        ))}
      </ul>
    </form>
  );
}
