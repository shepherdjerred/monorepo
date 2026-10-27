package com.shepherdjerred.thestorm.reset.adapter.luckperms;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.luckperms.api.LuckPerms;

/** Restores a LuckPerms user to the shared default group with no direct nodes. */
public final class LuckPermsReset {

  private final LuckPerms luckPerms;

  public LuckPermsReset(LuckPerms luckPerms) {
    this.luckPerms = luckPerms;
  }

  public CompletableFuture<Void> clear(UUID player) {
    return luckPerms
        .getUserManager()
        .loadUser(player)
        .thenCompose(
            user -> {
              user.data().clear();
              user.setPrimaryGroup("default");
              return luckPerms.getUserManager().saveUser(user);
            });
  }
}
