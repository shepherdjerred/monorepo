import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { leavingPopup } from "@shepherdjerred/console-ui/components/overlays/leaving-popup.tsx";
import {
  flattenOptions,
  groupOptions,
  matchesOption,
  OptionContent,
  type PickerOption,
  type PickerOptions,
} from "@shepherdjerred/console-ui/components/pickers/options.tsx";
import {
  useAsyncResults,
  type AsyncLoad,
  type AsyncResults,
} from "@shepherdjerred/console-ui/components/pickers/use-async-results.ts";
import { ICONS } from "@shepherdjerred/console-ui/icons.ts";

const AddIcon = ICONS.add;
const CloseIcon = ICONS.close;

type Row = PickerOption & { readonly kind: "option" | "create" };
type RowGroup = {
  readonly key: string;
  readonly label: string;
  readonly items: readonly Row[];
};

type ComboboxBaseProps = {
  /** The accessible name of the control and its list. */
  readonly label: string;
  /** The options, or the ones known before any search (keep the selected ones here). */
  readonly options?: PickerOptions;
  /**
   * Loads options for what is typed (also `""` on opening). Debounced, and
   * aborted when a newer query wins; "Searching…" shows meanwhile.
   */
  readonly loadOptions?: AsyncLoad<PickerOptions>;
  /** The wait before `loadOptions` runs, in ms (200). */
  readonly debounceMs?: number;
  readonly placeholder?: string;
  /** Shown when nothing matches ("No matches"). */
  readonly emptyText?: string;
  /**
   * Offers a "Create …" row when what is typed matches no option. Return
   * the new option to select it.
   */
  readonly onCreate?: (
    query: string,
  ) => PickerOption | undefined | Promise<PickerOption | undefined>;
  /** The create row's text ("Create “…”"). */
  readonly createLabel?: (query: string) => string;
  readonly id?: string;
  readonly disabled?: boolean;
};

export type ComboboxSingleProps = ComboboxBaseProps & {
  readonly multiple?: false;
  readonly value: string | null;
  readonly onValueChange: (value: string | null) => void;
};

export type ComboboxMultipleProps = ComboboxBaseProps & {
  readonly multiple: true;
  readonly value: readonly string[];
  readonly onValueChange: (values: string[]) => void;
};

export type ComboboxProps = ComboboxSingleProps | ComboboxMultipleProps;

const CREATE_GROUP = "\u0000create";

function asRow(option: PickerOption): Row {
  return { ...option, kind: "option" };
}

/** The groups to list: static or loaded options, then the create row. */
function rowGroups(
  props: ComboboxBaseProps,
  query: string,
  results: AsyncResults<PickerOptions>,
): RowGroup[] {
  const source =
    props.loadOptions === undefined
      ? (props.options ?? [])
      : results.status === "done"
        ? results.value
        : [];
  const groups = groupOptions(source).map((group) => ({
    key: group.label,
    label: group.label,
    items: group.options.map((option) => asRow(option)),
  }));
  const typed = query.trim();
  const exists = flattenOptions(source).some(
    (option) => option.label.toLowerCase() === typed.toLowerCase(),
  );
  if (typed === "" || exists || props.onCreate === undefined) return groups;
  const text = props.createLabel?.(typed) ?? `Create “${typed}”`;
  return [
    ...groups,
    {
      key: CREATE_GROUP,
      label: "",
      items: [
        { value: `${CREATE_GROUP}${typed}`, label: text, kind: "create" },
      ],
    },
  ];
}

/** Static options filter by every typed word; the create row always shows. */
function filterRow(row: Row, query: string): boolean {
  return row.kind === "create" || matchesOption(row, query);
}

function statusText(
  props: ComboboxBaseProps,
  results: AsyncResults<PickerOptions>,
): string | null {
  if (props.loadOptions === undefined || results.status === "idle") {
    return null;
  }
  if (results.status === "loading") return "Searching…";
  return results.status === "error" ? "Search failed. Try again." : null;
}

/** The list shared by both modes: status, empty line, groups and rows. */
function ComboboxList({
  status,
  emptyText,
}: {
  readonly status: string | null;
  readonly emptyText: string;
}): React.JSX.Element {
  return (
    <>
      <ComboboxPrimitive.Status className="ui-combobox-status">
        {status}
      </ComboboxPrimitive.Status>
      <ComboboxPrimitive.Empty className="ui-combobox-empty">
        {status === null ? emptyText : null}
      </ComboboxPrimitive.Empty>
      <ComboboxPrimitive.List className="ui-combobox-list">
        {(group: RowGroup) => (
          <ComboboxPrimitive.Group
            key={group.key}
            items={group.items}
            className="ui-menu-group"
          >
            {group.label === "" ? null : (
              <ComboboxPrimitive.GroupLabel className="ui-menu-label">
                {group.label}
              </ComboboxPrimitive.GroupLabel>
            )}
            <ComboboxPrimitive.Collection>
              {(row: Row) => (
                <ComboboxPrimitive.Item
                  key={row.value}
                  value={row}
                  disabled={row.disabled ?? false}
                  className="ui-menu-item"
                  data-create={row.kind === "create" ? "" : undefined}
                >
                  {row.kind === "create" ? (
                    <>
                      <AddIcon className="ui-menu-icon" aria-hidden="true" />
                      <span className="ui-menu-text">{row.label}</span>
                    </>
                  ) : (
                    <OptionContent option={row} />
                  )}
                  <ComboboxPrimitive.ItemIndicator className="ui-menu-check">
                    <CheckIcon aria-hidden="true" />
                  </ComboboxPrimitive.ItemIndicator>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.Collection>
          </ComboboxPrimitive.Group>
        )}
      </ComboboxPrimitive.List>
    </>
  );
}

/** The state both modes share: the query, async results and remembered picks. */
function useComboboxState(props: ComboboxBaseProps) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<readonly PickerOption[]>([]);
  const { results, request, cancel } = useAsyncResults(
    props.loadOptions,
    props.debounceMs ?? 200,
  );
  const groups = rowGroups(props, query, results);
  const known = [
    ...picked,
    ...flattenOptions(props.options ?? []),
    ...groups.flatMap((group) => group.items),
  ];
  const find = (value: string): Row =>
    asRow(
      known.find((option) => option.value === value) ?? {
        value,
        label: value,
      },
    );
  const remember = (option: PickerOption): void => {
    setPicked((before) => [
      ...before.filter((earlier) => earlier.value !== option.value),
      option,
    ]);
  };
  const typed = (next: string): void => {
    setQuery(next);
    if (props.loadOptions !== undefined) request(next);
  };
  const opened = (open: boolean): void => {
    if (open) {
      typed("");
    } else {
      cancel();
    }
  };
  /** Creates the typed option; resolves to it once it exists. */
  const create = async (row: Row): Promise<PickerOption | undefined> => {
    const created = await props.onCreate?.(
      row.value.slice(CREATE_GROUP.length),
    );
    if (created !== undefined) remember(created);
    return created;
  };
  return {
    /** The Base UI root props both modes share. */
    root: {
      items: groups,
      inputValue: query,
      autoHighlight: true,
      disabled: props.disabled ?? false,
      filter: props.loadOptions === undefined ? filterRow : null,
      itemToStringLabel: (row: Row) => row.label,
      isItemEqualToValue: (a: Row, b: Row) => a.value === b.value,
      onInputValueChange: (next: string) => {
        typed(next);
      },
    },
    status: statusText(props, results),
    emptyText:
      props.loadOptions !== undefined && query.trim() === ""
        ? "Type to search"
        : (props.emptyText ?? "No matches"),
    find,
    remember,
    typed,
    opened,
    create,
  };
}

function SingleCombobox(props: ComboboxSingleProps): React.JSX.Element {
  const state = useComboboxState(props);
  const selected = props.value === null ? null : state.find(props.value);
  async function choose(row: Row | null): Promise<void> {
    if (row === null) {
      props.onValueChange(null);
    } else if (row.kind === "create") {
      const created = await state.create(row);
      if (created !== undefined) props.onValueChange(created.value);
    } else {
      state.remember(row);
      props.onValueChange(row.value);
    }
  }
  return (
    <ComboboxPrimitive.Root
      {...state.root}
      value={selected}
      onValueChange={(row: Row | null) => {
        void choose(row);
      }}
      onOpenChange={(open) => {
        state.opened(open);
      }}
    >
      <ComboboxPrimitive.Trigger
        className="ui-picker"
        aria-label={props.label}
        {...(props.id === undefined ? {} : { id: props.id })}
      >
        <span className="ui-picker-value">
          {selected === null ? (
            <span className="ui-picker-placeholder">
              {props.placeholder ?? "Choose…"}
            </span>
          ) : (
            <OptionContent option={selected} compact />
          )}
        </span>
        <ComboboxPrimitive.Icon className="ui-picker-chevron">
          <ChevronDownIcon aria-hidden="true" />
        </ComboboxPrimitive.Icon>
      </ComboboxPrimitive.Trigger>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          className="ui-menu-positioner"
          align="start"
          sideOffset={4}
          collisionPadding={8}
        >
          <ComboboxPrimitive.Popup
            className="ui-menu"
            data-combobox=""
            aria-label={props.label}
            render={leavingPopup}
          >
            <ComboboxPrimitive.Input
              className="ui-combobox-search"
              aria-label={props.label}
              placeholder="Search…"
            />
            <ComboboxList status={state.status} emptyText={state.emptyText} />
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}

function MultipleCombobox(props: ComboboxMultipleProps): React.JSX.Element {
  const state = useComboboxState(props);
  const selected = props.value.map((value) => state.find(value));
  async function choose(rows: readonly Row[]): Promise<void> {
    const create = rows.find((row) => row.kind === "create");
    if (create !== undefined) {
      const created = await state.create(create);
      if (created !== undefined) {
        props.onValueChange([...props.value, created.value]);
      }
      return;
    }
    for (const row of rows) state.remember(row);
    props.onValueChange(rows.map((row) => row.value));
  }
  return (
    <ComboboxPrimitive.Root
      {...state.root}
      multiple
      value={selected}
      onValueChange={(rows: Row[]) => {
        void choose(rows);
      }}
      onOpenChange={(open, details) => {
        // Several values are picked from one opening.
        if (!open && details.reason === "item-press") {
          details.cancel();
          return;
        }
        state.opened(open);
      }}
    >
      <ComboboxPrimitive.InputGroup className="ui-picker" data-multiple="">
        <ComboboxPrimitive.Chips className="ui-combobox-chips">
          {selected.map((row) => (
            <ComboboxPrimitive.Chip
              key={row.value}
              className="ui-chip"
              data-kind="tag"
              aria-label={row.label}
            >
              {row.label}
              <ComboboxPrimitive.ChipRemove
                className="ui-combobox-chip-remove"
                aria-label={`Remove ${row.label}`}
              >
                <CloseIcon aria-hidden="true" />
              </ComboboxPrimitive.ChipRemove>
            </ComboboxPrimitive.Chip>
          ))}
          <ComboboxPrimitive.Input
            className="ui-combobox-input"
            aria-label={props.label}
            placeholder={
              selected.length > 0 ? "" : (props.placeholder ?? "Search…")
            }
            {...(props.id === undefined ? {} : { id: props.id })}
          />
        </ComboboxPrimitive.Chips>
      </ComboboxPrimitive.InputGroup>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          className="ui-menu-positioner"
          align="start"
          sideOffset={4}
          collisionPadding={8}
        >
          <ComboboxPrimitive.Popup
            className="ui-menu"
            data-combobox=""
            aria-label={props.label}
            render={leavingPopup}
          >
            <ComboboxList status={state.status} emptyText={state.emptyText} />
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}

/**
 * A searchable picker for long lists. Single: a 28px control that opens a
 * list with its own search line. Multiple: chips inside the control, each
 * removable with its × or Backspace. Options may be grouped, loaded as
 * typed (`loadOptions`) and extended with a "Create …" row (`onCreate`).
 */
export function Combobox(props: ComboboxProps): React.JSX.Element {
  return props.multiple === true ? (
    <MultipleCombobox {...props} />
  ) : (
    <SingleCombobox {...props} />
  );
}
