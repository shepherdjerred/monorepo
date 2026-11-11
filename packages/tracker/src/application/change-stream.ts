import type { LiveMessage } from "#shared/live-updates.ts";

export type ChangeSubscriber = {
  message: (message: LiveMessage) => void;
  /** The stream has shut down and will deliver nothing further. */
  closed: () => void;
};

/** Committed changes, delivered in commit order to in-process subscribers. */
export type ChangeStream = {
  /** Returns the function that removes this subscriber. */
  subscribe: (subscriber: ChangeSubscriber) => () => void;
};
