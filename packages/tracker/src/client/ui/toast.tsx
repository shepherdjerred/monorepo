import { Toast } from "@base-ui/react/toast";
import { X } from "lucide-react";
import { undoStack } from "#client/data/undo.ts";

const manager = Toast.createToastManager();

/**
 * Confirm an outcome. Toasts are the app's live region for outcomes; the
 * live-update announcer is the only other one.
 */
export function notify(title: string) {
  return manager.add({ title, type: "info", timeout: 4000 });
}

/** Report a failure; announced assertively and shown for longer. */
export function notifyError(title: string) {
  return manager.add({
    title,
    type: "error",
    priority: "high",
    timeout: 10_000,
  });
}

/**
 * Confirm an outcome and offer to undo it for as long as the toast shows.
 * `expire` runs when the toast goes away without Undo having been used.
 */
export function notifyUndo(
  title: string,
  actions: { undo: () => void; expire?: () => void },
) {
  let undone = false;
  const offer = undoStack.offer(() => {
    undone = true;
    manager.close(id);
    actions.undo();
  });
  const id = manager.add({
    title,
    type: "undo",
    timeout: 6000,
    actionProps: {
      children: "Undo",
      onClick: () => {
        undoStack.run(offer);
      },
    },
    onClose: () => {
      undoStack.withdraw(offer);
      if (!undone) {
        actions.expire?.();
      }
    },
  });
  return id;
}

export function dismissToast(id: string) {
  manager.close(id);
}

function Toasts() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    // Base UI calls each toast a dialog; here "dialog" means a modal surface
    // that takes over the keyboard, and a toast must never do that.
    <Toast.Root
      key={toast.id}
      toast={toast}
      className="toast"
      role="group"
      aria-modal={undefined}
    >
      <Toast.Content className="toast-content">
        <Toast.Title className="toast-title" render={<p />} />
        <Toast.Action className="toast-action" />
        {/* Base UI's own close button is hidden from assistive technology
            until the stack is hovered; this one is always on show. */}
        <button
          type="button"
          className="icon-button toast-close"
          aria-label="Dismiss"
          onClick={() => {
            manager.close(toast.id);
          }}
        >
          <X size={14} />
        </button>
      </Toast.Content>
    </Toast.Root>
  ));
}

/** The notification region: F6 moves focus into it, hover and focus hold it. */
export function Toaster() {
  return (
    <Toast.Provider toastManager={manager} limit={4}>
      <Toast.Portal>
        <Toast.Viewport className="toast-viewport">
          <Toasts />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
