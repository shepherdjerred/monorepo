import { useCallback, useRef, useState } from "react";
import { type Blocker, useBeforeUnload, useBlocker } from "react-router";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@scout-for-lol/design-system/components/dialog";

export function useUnsavedForm(
  dirty: boolean,
  submitting: boolean,
  isNavigationAllowed?: () => boolean,
): Blocker {
  const shouldBlock = useCallback(
    () => dirty && !submitting && !(isNavigationAllowed?.() === true),
    [dirty, isNavigationAllowed, submitting],
  );
  const blocker = useBlocker(shouldBlock);

  useBeforeUnload(
    useCallback(
      (event) => {
        if (!shouldBlock()) return;
        event.preventDefault();
      },
      [shouldBlock],
    ),
  );

  return blocker;
}

export function UnsavedFormDialog(props: { blocker: Blocker }) {
  const blocked = props.blocker.state === "blocked";
  return (
    <UnsavedChangesDialog
      open={blocked}
      onStay={() => {
        if (props.blocker.state === "blocked") props.blocker.reset();
      }}
      onDiscard={() => {
        if (props.blocker.state === "blocked") props.blocker.proceed();
      }}
    />
  );
}

export function useUnsavedFormTransition(dirty: boolean, submitting: boolean) {
  const navigationAllowed = useRef(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const request = useCallback(
    (action: () => void) => {
      if (submitting) return;
      if (!dirty) {
        action();
        return;
      }
      setPendingAction(() => action);
    },
    [dirty, submitting],
  );

  return {
    request,
    dialog: (
      <UnsavedChangesDialog
        open={pendingAction !== null}
        onStay={() => {
          navigationAllowed.current = false;
          setPendingAction(null);
        }}
        onDiscard={() => {
          const action = pendingAction;
          navigationAllowed.current = true;
          setPendingAction(null);
          action?.();
        }}
      />
    ),
    isNavigationAllowed: () => navigationAllowed.current,
  };
}

function UnsavedChangesDialog(props: {
  open: boolean;
  onStay: () => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onStay();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard unsaved changes?</DialogTitle>
          <DialogDescription>
            The information entered on this page has not been saved.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={props.onStay}>
            Stay on page
          </Button>
          <Button type="button" variant="destructive" onClick={props.onDiscard}>
            Discard changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
