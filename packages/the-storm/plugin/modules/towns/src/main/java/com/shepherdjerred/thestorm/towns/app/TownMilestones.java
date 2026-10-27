package com.shepherdjerred.thestorm.towns.app;

import java.util.UUID;
import java.util.function.Consumer;

/**
 * Saved town changes worth telling players outside the game about: a new town, and a town's claim
 * count after it grows. Listeners run on the main thread once the change is saved; a change that
 * was undone is never delivered. Main thread only.
 */
public interface TownMilestones {

  /** Delivers every later milestone to {@code listener} until the subscription is closed. */
  Subscription subscribe(Consumer<Milestone> listener);

  /** A live subscription; closing it is idempotent. */
  interface Subscription extends AutoCloseable {

    @Override
    void close();
  }

  /** Something a town did. */
  sealed interface Milestone {

    /**
     * A town was founded.
     *
     * @param town its name
     * @param founder who founded it
     */
    record Founded(String town, UUID founder) implements Milestone {}

    /**
     * A town claimed another chunk.
     *
     * @param townId the town
     * @param town its name
     * @param claims how many chunks it claims now
     */
    record Grew(UUID townId, String town, int claims) implements Milestone {}

    /**
     * A player joined a town, and that membership is saved.
     *
     * @param town its name
     * @param player who joined
     */
    record Joined(String town, UUID player) implements Milestone {}
  }
}
