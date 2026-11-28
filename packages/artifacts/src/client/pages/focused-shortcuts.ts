import type { ThreadView } from "@shepherdjerred/artifacts/procedures";
import { useShortcuts } from "#client/shell/shortcuts.ts";

export type ReviewKeys = {
  readonly framed: boolean;
  readonly active: boolean;
  readonly commentMode: boolean;
  readonly placing: boolean;
  readonly selected: ThreadView | undefined;
  readonly toggleCommentMode: () => void;
  readonly setActive: (active: boolean) => void;
  readonly setCommentMode: (on: boolean) => void;
  readonly cancelPlacement: () => void;
  readonly step: (direction: 1 | -1) => void;
  readonly version: (direction: 1 | -1) => void;
  readonly replyTo: (threadId: string) => void;
  readonly toggleResolved: (thread: ThreadView) => void;
};

/** C comment, Enter interact, Esc leave, J/K thread, R reply, E resolve, [ ] version. */
export function useReviewKeys(keys: ReviewKeys): void {
  useShortcuts([
    { key: "c", run: keys.toggleCommentMode },
    {
      key: "Enter",
      run: (event) => {
        if (keys.framed && !keys.active && !keys.commentMode)
          keys.setActive(true);
        else event.preventDefault();
      },
    },
    {
      key: "Escape",
      run: () => {
        if (keys.placing) keys.cancelPlacement();
        else if (keys.active) keys.setActive(false);
        else keys.setCommentMode(false);
      },
    },
    {
      key: "j",
      run: () => {
        keys.step(1);
      },
    },
    {
      key: "k",
      run: () => {
        keys.step(-1);
      },
    },
    {
      key: "r",
      run: (event) => {
        if (keys.selected === undefined) return;
        event.preventDefault();
        keys.replyTo(keys.selected.id);
      },
    },
    {
      key: "e",
      run: () => {
        if (keys.selected !== undefined) keys.toggleResolved(keys.selected);
      },
    },
    {
      key: "[",
      run: () => {
        keys.version(-1);
      },
    },
    {
      key: "]",
      run: () => {
        keys.version(1);
      },
    },
  ]);
}
