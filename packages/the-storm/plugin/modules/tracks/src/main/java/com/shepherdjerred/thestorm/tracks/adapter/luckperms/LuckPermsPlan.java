package com.shepherdjerred.thestorm.tracks.adapter.luckperms;

import com.shepherdjerred.thestorm.tracks.domain.TrackGroups;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * What {@link LuckPermsSync} writes, without LuckPerms types, so it can be tested without a
 * LuckPerms server: the groups to declare with their nodes, in order, and a player's track group
 * memberships.
 */
final class LuckPermsPlan {

  private LuckPermsPlan() {}

  /** A node this module adds to a group or user. */
  sealed interface NodeSpec {

    /** A plain permission node. */
    record Permission(String permission) implements NodeSpec {}

    /** Membership of (inheritance from) a group. */
    record Inherit(String group) implements NodeSpec {}
  }

  /**
   * A group to create if missing, and the nodes it must hold.
   *
   * @param name the group name
   * @param nodes the nodes to add; any others an administrator added are left alone
   */
  record GroupDeclaration(String name, List<NodeSpec> nodes) {

    GroupDeclaration {
      nodes = List.copyOf(nodes);
    }
  }

  /**
   * Every track group, parents before children, each granting its level and inheriting the last.
   */
  static List<GroupDeclaration> declarations() {
    return TrackGroups.definitions().stream()
        .map(
            definition -> {
              var nodes = new ArrayList<NodeSpec>(2);
              nodes.add(new NodeSpec.Permission(definition.permission()));
              definition.parent().ifPresent(parent -> nodes.add(new NodeSpec.Inherit(parent)));
              return new GroupDeclaration(definition.name(), nodes);
            })
        .toList();
  }

  /**
   * Whether a user's membership of {@code group} is managed here, and so is cleared before the
   * memberships for their current levels are added.
   */
  static boolean managed(String group) {
    return TrackGroups.isTrackGroup(group);
  }

  /** The track group memberships a player with {@code progress} must hold, and no others. */
  static Set<NodeSpec.Inherit> memberships(TrackProgress progress) {
    return TrackGroups.memberships(progress).stream()
        .map(NodeSpec.Inherit::new)
        .collect(java.util.stream.Collectors.toUnmodifiableSet());
  }
}
