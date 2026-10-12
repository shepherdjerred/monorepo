package com.shepherdjerred.thestorm.rwf.app;

import java.util.function.Consumer;

/**
 * Accepted match transitions, for bots, displays and relays. Listeners run on the main thread after
 * the transition's effects have been applied; refused events are never delivered. Main thread only.
 */
public interface MatchEvents {

  /** Delivers every later transition to {@code listener} until the subscription is closed. */
  Subscription subscribe(Consumer<MatchNotification> listener);

  /** A live subscription; closing it is idempotent. */
  interface Subscription extends AutoCloseable {

    @Override
    void close();
  }
}
