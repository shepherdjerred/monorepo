package com.shepherdjerred.thestorm.tracks.adapter.luckperms;

import com.shepherdjerred.thestorm.tracks.app.PermissionSync;
import com.shepherdjerred.thestorm.tracks.domain.TrackGroups;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.luckperms.api.LuckPerms;
import net.luckperms.api.node.NodeType;
import net.luckperms.api.node.types.InheritanceNode;
import net.luckperms.api.node.types.PermissionNode;

/**
 * Track levels as LuckPerms groups, through LuckPerms' asynchronous API only: nothing here blocks
 * or touches the world, and futures complete on LuckPerms' threads.
 *
 * <p>Groups are declared, never deleted, and only gain the nodes this module owns, so an
 * administrator's additions survive. A player's memberships in track groups are replaced as a
 * whole; their other groups are untouched.
 */
public final class LuckPermsSync implements PermissionSync {

  private final LuckPerms luckPerms;

  public LuckPermsSync(LuckPerms luckPerms) {
    this.luckPerms = luckPerms;
  }

  @Override
  public CompletableFuture<Void> declareGroups() {
    var groups = luckPerms.getGroupManager();
    // One group at a time, so each parent exists before its child names it.
    var chain = CompletableFuture.allOf();
    for (var definition : TrackGroups.definitions()) {
      chain =
          chain
              .thenCompose(ignored -> groups.createAndLoadGroup(definition.name()))
              .thenCompose(
                  group -> {
                    group.data().add(PermissionNode.builder(definition.permission()).build());
                    definition
                        .parent()
                        .ifPresent(
                            parent -> group.data().add(InheritanceNode.builder(parent).build()));
                    return groups.saveGroup(group);
                  });
    }
    return chain;
  }

  @Override
  public CompletableFuture<Void> apply(UUID player, TrackProgress progress) {
    var memberships = TrackGroups.memberships(progress);
    return luckPerms
        .getUserManager()
        .modifyUser(
            player,
            user -> {
              user.data()
                  .clear(
                      NodeType.INHERITANCE.predicate(
                          node -> TrackGroups.isTrackGroup(node.getGroupName())));
              for (var group : memberships) {
                user.data().add(InheritanceNode.builder(group).build());
              }
            });
  }
}
