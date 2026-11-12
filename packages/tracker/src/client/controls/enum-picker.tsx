import { createElement, type ReactNode } from "react";
import { Select } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { leavingPopup } from "#client/ui/leaving.tsx";

/** One choice of a short enumeration: a status, a priority, a sort order. */
export type EnumOption = { value: string; label: string; icon?: ReactNode };

export type EnumPickerProps = {
  /** The accessible name; a visible label may also wrap the picker. */
  label: string;
  value: string;
  options: readonly EnumOption[];
  onChange: (value: string) => void;
  /**
   * `field` shows icon, label and chevron; `icon` only the icon, for list
   * rows and cards; `action` a fixed button, for the bulk bar, whose value
   * never sticks.
   */
  variant?: "field" | "icon" | "action";
  action?: { text: string; icon: ReactNode };
  id?: string;
  disabled?: boolean;
  /** Row controls leave the tab order to the row; shortcuts open them. */
  tabIndex?: number;
  /** Shortcuts find a row's picker by `data-picker` and `data-issue`. */
  picker?: string;
  issue?: string;
  onFocus?: () => void;
};

/**
 * Chromium's customizable select: a real `<select>` whose button and picker
 * take rich content, so forms, autofill and the keyboard behave natively.
 */
export const customSelect =
  typeof CSS !== "undefined" && CSS.supports("appearance", "base-select");

function OptionContent({ option }: { option: EnumOption }) {
  return (
    <>
      {option.icon !== undefined && (
        <span className="option-icon">{option.icon}</span>
      )}
      <span className="option-label">{option.label}</span>
    </>
  );
}

function ActionContent({
  action,
}: {
  action: NonNullable<EnumPickerProps["action"]>;
}) {
  return (
    <>
      <span className="option-icon">{action.icon}</span>
      <span className="option-label">{action.text}</span>
    </>
  );
}

export function NativeEnumPicker(props: EnumPickerProps) {
  const { variant = "field", action } = props;
  return (
    <select
      className={`picker picker-${variant}`}
      id={props.id}
      aria-label={props.label}
      title={variant === "field" ? undefined : props.label}
      value={action === undefined ? props.value : ""}
      disabled={props.disabled}
      tabIndex={props.tabIndex}
      data-picker={props.picker}
      data-issue={props.issue}
      onFocus={props.onFocus}
      onChange={(event) => {
        props.onChange(event.target.value);
      }}
    >
      <button className="picker-button">
        {action === undefined ? (
          // React has no type for <selectedcontent> yet; it renders as is.
          createElement("selectedcontent")
        ) : (
          <ActionContent action={action} />
        )}
      </button>
      {action !== undefined && (
        <option value="" disabled hidden>
          {action.text}
        </option>
      )}
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          <OptionContent option={option} />
        </option>
      ))}
    </select>
  );
}

export function FallbackEnumPicker(props: EnumPickerProps) {
  const { variant = "field", action } = props;
  const selected = props.options.find(({ value }) => value === props.value);
  return (
    <Select.Root
      value={action === undefined ? props.value : null}
      disabled={props.disabled ?? false}
      modal={false}
      onValueChange={(value) => {
        if (typeof value === "string") {
          props.onChange(value);
        }
      }}
    >
      <Select.Trigger
        className={`picker picker-${variant}`}
        id={props.id}
        aria-label={props.label}
        title={variant === "field" ? undefined : props.label}
        tabIndex={props.tabIndex}
        data-picker={props.picker}
        data-issue={props.issue}
        onFocus={props.onFocus}
      >
        {action === undefined ? (
          selected !== undefined && <OptionContent option={selected} />
        ) : (
          <ActionContent action={action} />
        )}
        {variant === "field" && (
          <Select.Icon className="picker-chevron">
            <ChevronDown size={14} />
          </Select.Icon>
        )}
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          className="picker-positioner"
          sideOffset={4}
          align="start"
          alignItemWithTrigger={false}
        >
          <Select.Popup className="picker-popup" render={leavingPopup}>
            <Select.List className="picker-list">
              {props.options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  className="picker-item"
                >
                  {option.icon !== undefined && (
                    <span className="option-icon">{option.icon}</span>
                  )}
                  <Select.ItemText className="option-label">
                    {option.label}
                  </Select.ItemText>
                  <Select.ItemIndicator className="picker-check">
                    <Check size={14} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

/**
 * The picker for short enumerations. Where the browser has the customizable
 * select it is a native `<select>`; elsewhere the same props render a Base UI
 * Select, so every caller gets one behaviour.
 */
export function EnumPicker(props: EnumPickerProps) {
  return customSelect ? (
    <NativeEnumPicker {...props} />
  ) : (
    <FallbackEnumPicker {...props} />
  );
}

/**
 * Open a picker the way a click would: a native select shows its picker, a
 * Base UI trigger or a popover button is pressed. Showing a picker needs the
 * key press that asked for it; without one the picker keeps focus instead.
 */
export function openPicker(element: Element | null) {
  if (element instanceof HTMLSelectElement) {
    element.focus();
    try {
      element.showPicker();
    } catch {
      // No user activation: Space or Enter on the focused picker opens it.
    }
    return true;
  }
  if (element instanceof HTMLElement) {
    element.focus();
    element.click();
    return true;
  }
  return false;
}
