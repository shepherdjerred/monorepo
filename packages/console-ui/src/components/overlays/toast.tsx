import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import type { ReactNode } from "react";
import { StatusGlyph } from "@shepherdjerred/console-ui/components/status-glyph.tsx";
import { ICONS } from "@shepherdjerred/console-ui/icons.ts";
import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

const CloseIcon = ICONS.close;

type ToastData = { readonly severity: Severity; readonly word: string };

const manager = ToastPrimitive.createToastManager<ToastData>();

/** The undo offers on screen, newest last, so ⌘Z can take the latest. */
const undoOffers: { readonly id: string; readonly undo: () => void }[] = [];

export type ToastAction = { readonly label: string; readonly run: () => void };

export type NotifyOptions = {
  /** One follow-up, such as opening what was just created. */
  readonly action?: ToastAction;
  readonly description?: ReactNode;
  /** How long it shows, in ms (4000). Hover and focus hold it. */
  readonly timeout?: number;
  /** The word after the glyph ("Done"). */
  readonly word?: string;
};

export type ErrorOptions = {
  readonly description?: ReactNode;
  /** How long it shows, in ms (10000). */
  readonly timeout?: number;
  readonly word?: string;
};

export type UndoOptions = {
  /** Reverses the change; runs at most once. */
  readonly undo: () => void;
  /** Runs when the toast goes without Undo having been used. */
  readonly expire?: () => void;
  /** How long Undo is offered, in ms (6000). */
  readonly timeout?: number;
  readonly word?: string;
};

function notify(title: ReactNode, options: NotifyOptions = {}): string {
  const { action, description, timeout = 4000, word = "Done" } = options;
  const id: string = manager.add({
    title,
    description,
    type: "notify",
    timeout,
    data: { severity: "ok", word },
    ...(action === undefined
      ? {}
      : {
          actionProps: {
            children: action.label,
            onClick: () => {
              manager.close(id);
              action.run();
            },
          },
        }),
  });
  return id;
}

function error(title: ReactNode, options: ErrorOptions = {}): string {
  const { description, timeout = 10_000, word = "Error" } = options;
  return manager.add({
    title,
    description,
    type: "error",
    priority: "high",
    timeout,
    data: { severity: "error", word },
  });
}

function undo(title: ReactNode, options: UndoOptions): string {
  const { timeout = 6000, word = "Done" } = options;
  let undone = false;
  const withdraw = (): void => {
    const index = undoOffers.findIndex((offer) => offer.id === id);
    if (index !== -1) undoOffers.splice(index, 1);
  };
  const run = (): void => {
    if (undone) return;
    undone = true;
    withdraw();
    manager.close(id);
    options.undo();
  };
  const id: string = manager.add({
    title,
    type: "undo",
    timeout,
    data: { severity: "ok", word },
    actionProps: { children: "Undo", onClick: run },
    onClose: () => {
      withdraw();
      if (!undone) options.expire?.();
    },
  });
  undoOffers.push({ id, undo: run });
  return id;
}

/**
 * The toast API. Toasts confirm an outcome; they are never the only place
 * the information lives. `notify` is announced politely, `error`
 * assertively and shown for longer, `undo` offers Undo while it shows.
 * Each returns the toast's id for `dismiss`.
 */
export const toast = {
  notify,
  error,
  undo,
  dismiss: (id: string): void => {
    manager.close(id);
  },
  /** Runs the newest Undo on screen, e.g. from a ⌘Z shortcut; false if none. */
  undoLatest: (): boolean => {
    const latest = undoOffers.at(-1);
    if (latest === undefined) return false;
    latest.undo();
    return true;
  },
} as const;

function Toasts(): React.JSX.Element[] {
  const { toasts } = ToastPrimitive.useToastManager<ToastData>();
  return toasts.map((item) => (
    // Base UI calls each toast a dialog; a toast must never take over the
    // keyboard the way a dialog does, so it is a labelled group here.
    <ToastPrimitive.Root
      key={item.id}
      toast={item}
      className="ui-toast"
      role="group"
      aria-modal={undefined}
    >
      <ToastPrimitive.Content className="ui-toast-content">
        {item.data === undefined ? null : (
          <StatusGlyph severity={item.data.severity} label={item.data.word} />
        )}
        <div className="ui-toast-text">
          <ToastPrimitive.Title className="ui-toast-title" render={<p />} />
          <ToastPrimitive.Description
            className="ui-toast-description"
            render={<p />}
          />
        </div>
        <ToastPrimitive.Action className="ui-btn" />
        {/* Base UI's own close button hides from assistive technology until
            the stack is hovered; this one always shows. */}
        <button
          type="button"
          className="ui-icon-btn"
          aria-label="Dismiss"
          onClick={() => {
            manager.close(item.id);
          }}
        >
          <CloseIcon aria-hidden="true" />
        </button>
      </ToastPrimitive.Content>
    </ToastPrimitive.Root>
  ));
}

export type ToastProviderProps = {
  /** The most toasts on screen at once (4); older ones wait. */
  readonly limit?: number;
  readonly children?: ReactNode;
};

/**
 * The notification region, once per app. F6 moves focus into it; hover and
 * focus hold the toasts until they leave.
 */
export function ToastProvider({
  limit = 4,
  children,
}: ToastProviderProps): React.JSX.Element {
  return (
    <ToastPrimitive.Provider toastManager={manager} limit={limit}>
      {children}
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport className="ui-toasts">
          <Toasts />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  );
}
