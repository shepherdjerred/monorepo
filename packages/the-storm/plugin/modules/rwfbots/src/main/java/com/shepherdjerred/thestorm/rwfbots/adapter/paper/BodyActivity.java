package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import java.util.UUID;

/** Main-thread speech activity composed with native use and stationary kit casts. */
public interface BodyActivity {
  boolean typing(UUID uuid);

  void cancel(UUID uuid);
}
