package com.shepherdjerred.thestorm.quests.app;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Grants permission nodes as quest rewards (LuckPerms on the server). Futures complete off-thread.
 */
public interface PermissionGrants {

  /** The permission for title {@code id}. */
  static String title(String id) {
    return "thestorm.titles." + id;
  }

  /** The permission for having learned spell {@code id}. */
  static String spell(String id) {
    return "thestorm.spells.learned." + id;
  }

  /** Adds {@code permission} to {@code player} permanently. Granting it again does nothing. */
  CompletableFuture<Void> grant(UUID player, String permission);
}
