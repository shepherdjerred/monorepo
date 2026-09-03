import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@scout-for-lol/design-system/components/collapsible";

/**
 * Collapsed-by-default evidence. Radix supplies `aria-expanded`/`aria-controls`
 * on the trigger, which the old hand-rolled show/hide buttons never had.
 */
export function Disclosure(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Collapsible className="space-y-2">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded py-0.5 px-1.5 text-xs text-scout-subtle hover:text-scout-ink hover:bg-scout-surface transition-colors group"
        >
          <span>{props.label}</span>
          <ChevronDown
            className="size-3 text-scout-subtle transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>{props.children}</CollapsibleContent>
    </Collapsible>
  );
}
