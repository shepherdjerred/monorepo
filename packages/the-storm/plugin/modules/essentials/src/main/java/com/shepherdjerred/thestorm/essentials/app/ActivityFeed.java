package com.shepherdjerred.thestorm.essentials.app;

import java.util.UUID;
import java.util.function.BiConsumer;

/** Activity checkpoints, including AFK changes and disconnects. Callbacks may be asynchronous. */
public interface ActivityFeed {
  /** Observes whether time after each checkpoint is active. The returned action unsubscribes. */
  Runnable observe(BiConsumer<UUID, Boolean> observer);
}
