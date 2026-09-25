package com.shepherdjerred.thestorm.tracks.adapter.luckperms;

import com.shepherdjerred.thestorm.tracks.app.PermissionSync;
import com.shepherdjerred.thestorm.tracks.app.TrackStore;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.luckperms.api.LuckPerms;
import net.luckperms.api.node.Node;
import net.luckperms.api.node.NodeType;
import net.luckperms.api.node.types.InheritanceNode;
import net.luckperms.api.node.types.PermissionNode;

/**
 * Track levels as LuckPerms groups, through LuckPerms' asynchronous API only: nothing here blocks
 * or touches the world, and futures complete on LuckPerms' or the database's threads.
 *
 * <p>Groups are declared, never deleted, and only gain the nodes this module owns, so an
 * administrator's additions survive. A player's memberships in track groups are replaced as a
 * whole; their other groups are untouched. What is written is planned by {@link LuckPermsPlan}.
 *
 * <p>Applies for one player run one at a time, and each reads the player's latest stored progress
 * when it runs rather than a snapshot taken when it was requested, so two changes in quick
 * succession can never leave LuckPerms on the older one.
 */
public final class LuckPermsSync implements PermissionSync {

  private final LuckPerms luckPerms;
  private final TrackStore store;
  private final KeyedQueue<UUID> queue = new KeyedQueue<>();

  public LuckPermsSync(LuckPerms luckPerms, TrackStore store) {
    this.luckPerms = luckPerms;
    this.store = store;
  }

  @Override
  public CompletableFuture<Void> declareGroups() {
    var groups = luckPerms.getGroupManager();
    // One group at a time, so each parent exists before its child names it.
    var chain = CompletableFuture.allOf();
    for (var declaration : LuckPermsPlan.declarations()) {
      chain =
          chain
              .thenCompose(ignored -> groups.createAndLoadGroup(declaration.name()))
              .thenCompose(
                  group -> {
                    for (var node : declaration.nodes()) {
                      group.data().add(toNode(node));
                    }
                    return groups.saveGroup(group);
                  });
    }
    return chain;
  }

  @Override
  public CompletableFuture<Void> apply(UUID player) {
    return queue.submit(
        player, () -> store.load(player).thenCompose(latest -> write(player, latest)));
  }

  private CompletableFuture<Void> write(UUID player, TrackProgress progress) {
    var memberships = LuckPermsPlan.memberships(progress);
    return luckPerms
        .getUserManager()
        .modifyUser(
            player,
            user -> {
              user.data()
                  .clear(
                      NodeType.INHERITANCE.predicate(
                          node -> LuckPermsPlan.managed(node.getGroupName())));
              for (var membership : memberships) {
                user.data().add(toNode(membership));
              }
            });
  }

  private static Node toNode(LuckPermsPlan.NodeSpec spec) {
    return switch (spec) {
      case LuckPermsPlan.NodeSpec.Permission(var permission) ->
          PermissionNode.builder(permission).build();
      case LuckPermsPlan.NodeSpec.Inherit(var group) -> InheritanceNode.builder(group).build();
    };
  }
}
