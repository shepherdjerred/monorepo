package com.shepherdjerred.thestorm.essentials.app.store;

import com.shepherdjerred.thestorm.essentials.domain.back.BackEntry;
import com.shepherdjerred.thestorm.essentials.domain.back.BackHistory;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Where players were before teleporting or dying. */
public interface BackStore {

  /** Records {@code entry} as the newest, keeping only the newest {@code capacity} entries. */
  CompletableFuture<Void> push(UUID player, BackEntry entry, int capacity);

  /** {@code player}'s newest {@code capacity} entries. */
  CompletableFuture<BackHistory> history(UUID player, int capacity);
}
