package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import java.util.UUID;

/** Main-thread speech activity composed with native use and stationary kit casts. */
public interface BodyActivity {
  boolean typing(UUID uuid);

  void cancel(UUID uuid);

  /**
   * The body is in the air (a jump, a leap, a fall): speech must not take its control now. A line
   * that should outlast the landing waits for it; by default the line is dropped.
   */
  default void defer(UUID uuid) {
    cancel(uuid);
  }
}
