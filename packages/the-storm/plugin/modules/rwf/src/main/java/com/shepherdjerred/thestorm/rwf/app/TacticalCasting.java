package com.shepherdjerred.thestorm.rwf.app;

import java.util.UUID;

/** The body samples this on the main thread before applying voluntary commands. */
public interface TacticalCasting {
  boolean stationary(UUID fighter);
}
