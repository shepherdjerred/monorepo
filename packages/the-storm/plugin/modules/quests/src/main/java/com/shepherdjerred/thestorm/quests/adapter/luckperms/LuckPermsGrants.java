package com.shepherdjerred.thestorm.quests.adapter.luckperms;

import com.shepherdjerred.thestorm.quests.app.PermissionGrants;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.luckperms.api.LuckPerms;
import net.luckperms.api.node.types.PermissionNode;

/**
 * Quest permission rewards as LuckPerms nodes, through LuckPerms' asynchronous API: it loads the
 * user if they are offline, adds the node and saves. Adding a node the user has is a no-op.
 */
public final class LuckPermsGrants implements PermissionGrants {

  private final LuckPerms luckPerms;

  public LuckPermsGrants(LuckPerms luckPerms) {
    this.luckPerms = luckPerms;
  }

  @Override
  public CompletableFuture<Void> grant(UUID player, String permission) {
    return luckPerms
        .getUserManager()
        .modifyUser(player, user -> user.data().add(PermissionNode.builder(permission).build()));
  }
}
