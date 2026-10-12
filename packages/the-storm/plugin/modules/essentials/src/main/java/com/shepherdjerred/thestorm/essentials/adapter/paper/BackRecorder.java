package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.essentials.app.store.BackStore;
import com.shepherdjerred.thestorm.essentials.domain.back.BackEntry;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.util.UUID;

/** Records the places players leave, for {@code /back}. Writes asynchronously. */
final class BackRecorder {

  private final PaperRuntime runtime;
  private final BackStore store;
  private final int capacity;
  private final SealedWorlds sealed;

  BackRecorder(PaperRuntime runtime, BackStore store, int capacity, SealedWorlds sealed) {
    this.runtime = runtime;
    this.store = store;
    this.capacity = capacity;
    this.sealed = sealed;
  }

  void record(UUID player, Position left, BackEntry.Cause cause) {
    if (sealed.isSealed(left.world())) {
      return;
    }
    var entry = new BackEntry(left, cause, runtime.time().instant());
    runtime.logFailure(store.push(player, entry, capacity), "recording /back history");
  }
}
