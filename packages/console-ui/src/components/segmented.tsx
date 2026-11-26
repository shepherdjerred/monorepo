import {
  RadioOptions,
  type TabsProps,
} from "@shepherdjerred/console-ui/components/tabs.tsx";

/**
 * A pill-shaped filter for one list, with optional counts. Like `Tabs`, it is
 * a radio group with one tab stop; arrow keys, Home and End move the choice.
 */
export function Segmented<Value extends string>(
  props: TabsProps<Value>,
): React.JSX.Element {
  return (
    <RadioOptions
      {...props}
      groupClass="ui-segmented"
      countClass="ui-segmented-count"
    />
  );
}
