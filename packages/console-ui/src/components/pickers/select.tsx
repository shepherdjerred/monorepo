import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { leavingPopup } from "@shepherdjerred/console-ui/components/overlays/leaving-popup.tsx";
import {
  flattenOptions,
  groupOptions,
  OptionContent,
  type PickerOptions,
} from "@shepherdjerred/console-ui/components/pickers/options.tsx";

export type SelectProps = {
  /** The accessible name; a visible `<label htmlFor={id}>` may also name it. */
  readonly label: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly options: PickerOptions;
  readonly id?: string;
  /** Submits the value with a form. */
  readonly name?: string;
  readonly disabled?: boolean;
  /** Shown while `value` matches no option. */
  readonly placeholder?: string;
};

/**
 * The 28px picker for a short list of values: a status, a sort order. A
 * Base UI select, so every browser gets the same look and keyboard. Use
 * `Combobox` when the list is long enough to search.
 */
export function Select({
  label,
  value,
  onValueChange,
  options,
  id,
  name,
  disabled = false,
  placeholder = "Choose…",
}: SelectProps): React.JSX.Element {
  const selected = flattenOptions(options).find(
    (option) => option.value === value,
  );
  return (
    <SelectPrimitive.Root
      value={value}
      disabled={disabled}
      modal={false}
      {...(name === undefined ? {} : { name })}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next);
      }}
    >
      <SelectPrimitive.Trigger
        className="ui-picker"
        aria-label={label}
        {...(id === undefined ? {} : { id })}
      >
        <span className="ui-picker-value">
          {selected === undefined ? (
            <span className="ui-picker-placeholder">{placeholder}</span>
          ) : (
            <OptionContent option={selected} compact />
          )}
        </span>
        <SelectPrimitive.Icon className="ui-picker-chevron">
          <ChevronDownIcon aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          className="ui-menu-positioner"
          sideOffset={4}
          align="start"
          alignItemWithTrigger={false}
          collisionPadding={8}
        >
          <SelectPrimitive.Popup
            className="ui-menu"
            data-listbox=""
            render={leavingPopup}
          >
            <SelectPrimitive.List>
              {groupOptions(options).map((group) => (
                <SelectPrimitive.Group
                  key={group.label}
                  className="ui-menu-group"
                >
                  {group.label === "" ? null : (
                    <SelectPrimitive.GroupLabel className="ui-menu-label">
                      {group.label}
                    </SelectPrimitive.GroupLabel>
                  )}
                  {group.options.map((option) => (
                    <SelectPrimitive.Item
                      key={option.value}
                      value={option.value}
                      label={option.label}
                      disabled={option.disabled ?? false}
                      className="ui-menu-item"
                    >
                      <OptionContent option={option} />
                      <SelectPrimitive.ItemIndicator className="ui-menu-check">
                        <CheckIcon aria-hidden="true" />
                      </SelectPrimitive.ItemIndicator>
                    </SelectPrimitive.Item>
                  ))}
                </SelectPrimitive.Group>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
