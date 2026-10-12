package com.shepherdjerred.thestorm.arena.app;

import java.util.function.Consumer;

/**
 * Accepted Mob Arena transitions, for relays. Listeners run on the main thread after the
 * transition's effects have been carried out; refused events are never delivered. Survival maps are
 * not included. Main thread only.
 */
public interface ArenaEvents {

  /** Delivers every later transition to {@code listener} until the subscription is closed. */
  Subscription subscribe(Consumer<ArenaNotification> listener);

  /** A live subscription; closing it is idempotent. */
  interface Subscription extends AutoCloseable {

    @Override
    void close();
  }
}
