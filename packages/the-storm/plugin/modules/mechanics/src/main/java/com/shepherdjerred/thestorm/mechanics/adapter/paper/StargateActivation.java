package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Cancellable;

/** Cleanup for a failed portal placement; keep the original failure visible. */
final class StargateActivation {
  private StargateActivation() {}

  static void abort(Cancellable closing, Runnable cleanup, RuntimeException failure) {
    closing.cancel();
    try {
      cleanup.run();
    } catch (RuntimeException cleanupFailure) {
      failure.addSuppressed(cleanupFailure);
    }
  }
}
