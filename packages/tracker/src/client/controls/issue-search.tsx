import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Combobox } from "@base-ui/react/combobox";
import { api } from "#client/data/api.ts";
import { StateIcon } from "#client/ui/icons.tsx";

type Found = {
  identifier: string;
  title: string;
  state: { type: Parameters<typeof StateIcon>[0]["type"]; color: string };
};

/**
 * A field that finds an issue by identifier or words of its title, through
 * `search.query`. What is typed stays the value, so an identifier typed in
 * full needs no pick; choosing a result fills in its identifier. Used for
 * relation targets and, next, for an issue's parent.
 */
export function IssueSearchCombobox({
  value,
  onValueChange,
  label,
  placeholder = "Search or type an identifier…",
  exclude = [],
  id,
}: {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  placeholder?: string;
  /** Issues that cannot be chosen, such as the issue itself. */
  exclude?: readonly string[];
  id?: string;
}) {
  const query = value.trim();
  const results = useQuery({
    queryKey: ["search", query],
    queryFn: () => api.search.query.query({ query }),
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
  });
  const [chosen, setChosen] = useState<Found>();
  const items: Found[] = (results.data?.items ?? []).filter(
    ({ identifier }) => !exclude.includes(identifier),
  );
  // A typed identifier that exists is chosen as typed, so leaving the
  // field keeps it instead of clearing text that matched no pick.
  const matches = (item: Found | undefined) =>
    item?.identifier.toLowerCase() === query.toLowerCase();
  const exact =
    items.find((item) => matches(item)) ??
    (matches(chosen) ? chosen : undefined);
  return (
    <Combobox.Root
      items={items}
      filteredItems={items}
      value={exact ?? null}
      inputValue={value}
      autoHighlight
      itemToStringLabel={(item: Found) => item.identifier}
      isItemEqualToValue={(a: Found, b: Found) => a.identifier === b.identifier}
      onInputValueChange={(next) => {
        onValueChange(next);
      }}
      onValueChange={(item: Found | null) => {
        if (item !== null) {
          setChosen(item);
          onValueChange(item.identifier);
        }
      }}
    >
      <Combobox.Input
        id={id}
        className="issue-search-input"
        aria-label={label}
        placeholder={placeholder}
        autoComplete="off"
      />
      <Combobox.Portal>
        <Combobox.Positioner
          className="picker-positioner"
          sideOffset={4}
          align="start"
          collisionPadding={8}
        >
          <Combobox.Popup className="picker-popup issue-search-popup">
            <Combobox.Empty className="picker-empty">
              {query === ""
                ? "Type an identifier or words from a title"
                : results.isFetching
                  ? "Searching…"
                  : "No matching issues"}
            </Combobox.Empty>
            <Combobox.List className="picker-list">
              {(item: Found) => (
                <Combobox.Item
                  key={item.identifier}
                  value={item}
                  className="picker-item"
                >
                  <span className="option-icon">
                    <StateIcon
                      type={item.state.type}
                      color={item.state.color}
                    />
                  </span>
                  <span className="identifier">{item.identifier}</span>
                  <span className="option-label">{item.title}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
