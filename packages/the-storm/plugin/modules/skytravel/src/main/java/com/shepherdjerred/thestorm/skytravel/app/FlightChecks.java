package com.shepherdjerred.thestorm.skytravel.app;

import java.util.UUID;

/** Narrow movement-check ownership during server-assisted travel; combat checks remain enabled. */
public interface FlightChecks {
  void active(UUID player, boolean active);

  void stop();

  static FlightChecks absent() {
    return new FlightChecks() {
      @Override
      public void active(UUID player, boolean active) {}

      @Override
      public void stop() {}
    };
  }
}
