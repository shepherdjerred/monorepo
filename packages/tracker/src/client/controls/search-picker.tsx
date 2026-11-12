import { useRef, useState } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Check, Minus } from "lucide-react";
import type { BootstrapData } from "#client/data/api.ts";
import { createLabel } from "#client/data/catalog-mutations.ts";
import {
  pickerGroups,
  pickerPlaceholder,
  type PickerGroup,
  type PickerItem,
  type SearchPickerKind,
} from "./picker-items.tsx";
import { createPopupStore, pageScope, type PopupEntry } from "./popup-store.ts";
import { leavingPopup } from "#client/ui/leaving.tsx";

/**
 * What a searchable picker edits. Callers bind `pick` to one issue, a
 * selection or a form; the picker itself only knows values.
 */
export type SearchPickerRequest = {
  kind: SearchPickerKind;
  /** The control the picker opens from, and where focus returns. */
  anchor: HTMLElement;
  teamId: string;
  teamKey: string;
  /** The accessible name of the popup, e.g. "Assignee of AI-12". */
  title: string;
  /** Actor keys, label names or project slugs that are set now. */
  selected: readonly string[];
  /** Labels only some of several issues carry. */
  mixed?: readonly string[];
  /** Set a single value (null clears it) or toggle one label on or off. */
  pick: (value: string | null, add: boolean) => void;
};

type Open = PopupEntry<SearchPickerRequest>;
const pickers = createPopupStore<SearchPickerRequest>();

/** Open the one searchable picker, anchored to `request.anchor`. */
export function openSearchPicker(request: SearchPickerRequest) {
  pickers.open(request);
}

function closeSearchPicker(id: number) {
  pickers.close(id);
}

function forgetSearchPicker(id: number) {
  pickers.forget(id);
}

const labelColors = [
  "#e46169",
  "#f2994a",
  "#d9b44a",
  "#4cb782",
  "#5e9bd6",
  "#8b5cf6",
];

function flatten(groups: readonly PickerGroup[]) {
  return groups.flatMap((group) => group.items);
}

function Row({
  item,
  index,
  state,
}: {
  item: PickerItem;
  index: number;
  state: "on" | "off" | "mixed" | undefined;
}) {
  return (
    <Combobox.Item value={item} className="picker-item" data-kind={item.kind}>
      {state !== undefined && (
        <span className="picker-box" data-state={state} aria-hidden="true">
          {state === "on" && <Check size={12} />}
          {state === "mixed" && <Minus size={12} />}
        </span>
      )}
      <span className="option-icon">{item.icon}</span>
      <span className="option-label">{item.label}</span>
      {item.detail !== undefined && (
        <span className="picker-detail">{item.detail}</span>
      )}
      {state === undefined && (
        <Combobox.ItemIndicator className="picker-check">
          <Check size={14} />
        </Combobox.ItemIndicator>
      )}
      {index < 9 && item.kind === "value" && (
        <kbd className="picker-number" aria-hidden="true">
          {index + 1}
        </kbd>
      )}
    </Combobox.Item>
  );
}

function SearchPicker({
  entry,
  bootstrap,
}: {
  entry: Open;
  bootstrap: BootstrapData;
}) {
  const { request } = entry;
  const multiple = request.kind === "labels";
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [checked, setChecked] = useState(() => new Set(request.selected));
  const [mixed, setMixed] = useState(() => new Set(request.mixed));
  const keepOpen = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const groups = pickerGroups(
    request.kind,
    { bootstrap, teamId: request.teamId, query, expanded },
    bootstrap.writesEnabled,
  );
  const items = flatten(groups);
  const numbered = items.filter((item) => item.kind === "value");

  function close() {
    closeSearchPicker(entry.id);
  }

  function choose(item: PickerItem) {
    if (item.kind === "more") {
      keepOpen.current = true;
      setExpanded((known) => new Set([...known, item.value ?? ""]));
      return;
    }
    if (item.kind === "create") {
      const name = item.value ?? "";
      keepOpen.current = multiple;
      setQuery("");
      setChecked((known) => new Set([...known, name]));
      void (async () => {
        const outcome = await createLabel({
          teamKey: request.teamKey,
          name,
          color: labelColors[name.length % labelColors.length] ?? "#8b5cf6",
        });
        if (outcome.ok) {
          request.pick(name, true);
        }
      })();
      return;
    }
    if (!multiple) {
      request.pick(item.value, true);
      return;
    }
    const value = item.value ?? "";
    const add = !checked.has(value) || mixed.has(value);
    keepOpen.current = true;
    setChecked((known) => {
      const next = new Set(known);
      if (add) {
        next.add(value);
      } else {
        next.delete(value);
      }
      return next;
    });
    setMixed((known) => new Set([...known].filter((name) => name !== value)));
    request.pick(value, add);
  }

  const selectedItems = items.filter(
    (item) =>
      item.kind === "value" &&
      (item.value === null
        ? request.selected.length === 0 && !multiple
        : checked.has(item.value)),
  );
  const state = (item: PickerItem) => {
    if (!multiple || item.kind !== "value" || item.value === null) {
      return;
    }
    if (mixed.has(item.value)) {
      return "mixed";
    }
    return checked.has(item.value) ? "on" : "off";
  };
  const shared = {
    open: entry.open,
    items: groups,
    filteredItems: groups,
    inputValue: query,
    autoHighlight: true,
    itemToStringLabel: (item: PickerItem) => item.label,
    isItemEqualToValue: (a: PickerItem, b: PickerItem) => a.id === b.id,
    onInputValueChange: (value: string) => {
      setQuery(value);
    },
    onOpenChange: (
      open: boolean,
      details: Combobox.Root.ChangeEventDetails,
    ) => {
      if (open) {
        return;
      }
      if (keepOpen.current && details.reason === "item-press") {
        keepOpen.current = false;
        details.cancel();
        return;
      }
      keepOpen.current = false;
      close();
    },
    onOpenChangeComplete: (open: boolean) => {
      if (!open) {
        forgetSearchPicker(entry.id);
      }
    },
  };
  const body = (
    <Combobox.Portal>
      <Combobox.Positioner
        className="picker-positioner"
        anchor={request.anchor}
        side="bottom"
        align="start"
        sideOffset={4}
        collisionPadding={8}
      >
        <Combobox.Popup
          className="picker-popup search-picker"
          render={leavingPopup}
          aria-label={request.title}
          initialFocus={input}
          finalFocus={() =>
            request.anchor.isConnected ? request.anchor : true
          }
        >
          <Combobox.Input
            ref={input}
            className="picker-search"
            placeholder={pickerPlaceholder[request.kind]}
            aria-label={request.title}
            onKeyDown={(event) => {
              // With nothing typed, 1–9 pick the nth row as in Linear.
              const digit = /^[1-9]$/u.test(event.key) ? Number(event.key) : 0;
              const item = numbered[digit - 1];
              if (
                query === "" &&
                item !== undefined &&
                !event.metaKey &&
                !event.ctrlKey
              ) {
                event.preventDefault();
                choose(item);
                if (!multiple) {
                  close();
                }
              }
            }}
          />
          <Combobox.Empty className="picker-empty">No matches</Combobox.Empty>
          <Combobox.List className="picker-list">
            {(group: PickerGroup) => (
              <Combobox.Group
                key={group.value}
                items={group.items}
                className="picker-group"
              >
                {group.label !== "" && (
                  <Combobox.GroupLabel className="picker-group-label">
                    {group.label}
                  </Combobox.GroupLabel>
                )}
                <Combobox.Collection>
                  {(item: PickerItem) => (
                    <Row
                      key={item.id}
                      item={item}
                      index={numbered.indexOf(item)}
                      state={state(item)}
                    />
                  )}
                </Combobox.Collection>
              </Combobox.Group>
            )}
          </Combobox.List>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Portal>
  );
  if (multiple) {
    return (
      <Combobox.Root
        {...shared}
        multiple
        value={selectedItems}
        onValueChange={(next: PickerItem[]) => {
          const before = new Set(selectedItems.map(({ id }) => id));
          const after = new Set(next.map(({ id }) => id));
          const toggled =
            next.find(({ id }) => !before.has(id)) ??
            selectedItems.find(({ id }) => !after.has(id));
          if (toggled !== undefined) {
            choose(toggled);
          }
        }}
      >
        {body}
      </Combobox.Root>
    );
  }
  return (
    <Combobox.Root
      {...shared}
      value={selectedItems[0] ?? null}
      onValueChange={(next: PickerItem | null) => {
        if (next !== null) {
          choose(next);
        }
      }}
    >
      {body}
    </Combobox.Root>
  );
}

/**
 * Renders the searchable picker every row, card, panel and bar opens, when
 * it was opened within this host's scope: the page, or one dialog.
 */
export function SearchPickerHost({
  bootstrap,
  scope = pageScope,
}: {
  bootstrap: BootstrapData;
  scope?: string;
}) {
  const entry = pickers.useEntry(scope);
  return entry === undefined ? null : (
    <SearchPicker key={entry.id} entry={entry} bootstrap={bootstrap} />
  );
}
