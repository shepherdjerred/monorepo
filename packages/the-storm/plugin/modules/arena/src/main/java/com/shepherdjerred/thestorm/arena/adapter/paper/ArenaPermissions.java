package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.kit.ClassBook;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.permissions.Permission;
import org.bukkit.permissions.PermissionDefault;
import org.bukkit.plugin.PluginManager;

/**
 * The arena's permissions. Playing, watching and the leaderboard are open to everyone; advanced
 * classes are granted by quests (through LuckPerms); the admin tools are for operators.
 */
final class ArenaPermissions {

  static final String PLAY = "thestorm.arena.join";
  static final String SPECTATE = "thestorm.arena.spectate";
  static final String TOP = "thestorm.arena.top";
  static final String ADMIN = "thestorm.arena.admin";

  private final PluginManager manager;
  private final List<Permission> registered = new ArrayList<>();

  ArenaPermissions(PluginManager manager) {
    this.manager = manager;
  }

  void register(ClassBook classes) {
    add(PLAY, "Join, leave and play in arenas", PermissionDefault.TRUE);
    add(SPECTATE, "Watch an arena game", PermissionDefault.TRUE);
    add(TOP, "See an arena's leaderboard", PermissionDefault.TRUE);
    add(ADMIN, "Start and stop games and print arena coordinates", PermissionDefault.OP);
    for (var entry : classes.classes().entrySet()) {
      if (entry.getValue().advanced()) {
        add(
            ClassBook.permission(entry.getKey()),
            "Play the advanced " + entry.getValue().name() + " class",
            PermissionDefault.FALSE);
      }
    }
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
