package com.shepherdjerred.thestorm.essentials.app;

import java.util.UUID;

/** Whether players are away from the keyboard. Safe from any thread; answers from memory. */
public interface AfkStatus {

  /** Whether {@code player} is online and marked away. */
  boolean isAfk(UUID player);
}
