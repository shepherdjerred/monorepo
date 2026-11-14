import { useRef } from "react";
import { Popover } from "@base-ui/react/popover";
import { localToday, type CalendarDay } from "./dates.ts";
import {
  createPopupStore,
  pageScope,
  type PopupEntry,
} from "#client/controls/popup-store.ts";
import { deferred } from "#client/ui/lazy.ts";
import { leavingPopup } from "#client/ui/leaving.tsx";
import { notifyError } from "#client/ui/toast.tsx";

/**
 * The picker's panel, its month grid and the date parser are not needed
 * for the first paint, so they load when a due date control is approached.
 */
export const duePanel = deferred(() => import("./due-panel.tsx"));

/** What a due date picker edits; callers bind `pick` to issues or a form. */
export type DuePickerRequest = {
  anchor: HTMLElement;
  /** The accessible name of the popup, e.g. "Due date of AI-12". */
  title: string;
  value: CalendarDay | null;
  pick: (day: CalendarDay | null) => void;
};

type Open = PopupEntry<DuePickerRequest>;
const pickers = createPopupStore<DuePickerRequest>();

/** Open the one due date picker at `anchor`, once its code is here. */
export function openDuePicker(request: DuePickerRequest) {
  void (async () => {
    try {
      await duePanel.load();
    } catch {
      notifyError("The date picker could not load. Check the connection.");
      return;
    }
    pickers.open(request);
  })();
}

function DuePopover({ entry }: { entry: Open }) {
  const { request } = entry;
  const input = useRef<HTMLInputElement>(null);
  const Panel = duePanel.current?.DuePanel;
  if (Panel === undefined) {
    throw new Error("The due date panel opened before it loaded");
  }
  const close = () => {
    pickers.close(entry.id);
  };
  return (
    <Popover.Root
      open={entry.open}
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      onOpenChangeComplete={(open) => {
        if (!open) {
          pickers.forget(entry.id);
        }
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          className="picker-positioner"
          anchor={request.anchor}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
        >
          <Popover.Popup
            className="picker-popup due-popover"
            render={leavingPopup}
            aria-label={request.title}
            initialFocus={input}
            finalFocus={() =>
              request.anchor.isConnected ? request.anchor : true
            }
          >
            <Panel
              value={request.value}
              today={localToday()}
              clearable
              label={request.title}
              inputRef={input}
              onPick={(day) => {
                request.pick(day);
                close();
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Renders the due date picker when it was opened within this host's scope. */
export function DuePickerHost({ scope = pageScope }: { scope?: string }) {
  const entry = pickers.useEntry(scope);
  return entry === undefined ? null : (
    <DuePopover key={entry.id} entry={entry} />
  );
}
