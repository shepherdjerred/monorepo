package com.shepherdjerred.thestorm.rwf.adapter.paper;

import java.util.ArrayList;
import java.util.List;
import org.bukkit.permissions.Permission;
import org.bukkit.permissions.PermissionDefault;
import org.bukkit.plugin.PluginManager;

/**
 * The module's permissions: playing, voting, statistics and watching are open to everyone; running
 * matches is for operators, and teleporting to enemy stealth kits for moderators.
 */
final class RwfPermissions {

  static final String PLAY = "thestorm.rwf.play";
  static final String VOTE = "thestorm.rwf.vote";
  static final String STATS = "thestorm.rwf.stats";
  static final String SPECTATE = "thestorm.rwf.spectate";
  static final String SUICIDE = "thestorm.rwf.suicide";
  static final String SPECTATE_ANYONE = "thestorm.rwf.spectate.anyone";
  static final String ADMIN = "thestorm.rwf.admin";
  static final String RUN = "thestorm.rwf.admin.run";

  private final PluginManager manager;
  private final List<Permission> registered = new ArrayList<>();

  RwfPermissions(PluginManager manager) {
    this.manager = manager;
  }

  void register() {
    add(PLAY, "Join, leave and play Search and Destroy", PermissionDefault.TRUE);
    add(VOTE, "Vote for the next Search and Destroy map", PermissionDefault.TRUE);
    add(STATS, "Read Search and Destroy statistics and match history", PermissionDefault.TRUE);
    add(SPECTATE, "Watch Search and Destroy without playing", PermissionDefault.TRUE);
    add(SUICIDE, "Give up your life in a Search and Destroy match", PermissionDefault.TRUE);
    add(
        SPECTATE_ANYONE,
        "Teleport to enemy stealth kits while spectating Search and Destroy",
        PermissionDefault.OP);
    add(
        ADMIN,
        "Inspect, repair, load-test and showcase Search and Destroy, and enter its worlds freely",
        PermissionDefault.OP);
    add(
        RUN,
        "Start, stop, skip, extend and steer Search and Destroy matches, and quarantine maps",
        PermissionDefault.OP);
  }

  private void add(String name, String description, PermissionDefault fallback) {
    var permission = new Permission(name, description, fallback);
    manager.addPermission(permission);
    registered.add(permission);
  }

  void unregister() {
    registered.forEach(manager::removePermission);
    registered.clear();
  }
}
