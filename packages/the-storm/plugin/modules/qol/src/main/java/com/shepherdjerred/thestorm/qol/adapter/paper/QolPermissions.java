package com.shepherdjerred.thestorm.qol.adapter.paper;

import java.util.ArrayList;
import java.util.List;
import org.bukkit.permissions.Permission;
import org.bukkit.permissions.PermissionDefault;
import org.bukkit.plugin.PluginManager;

/**
 * Qol's permissions. Player features default to everyone and staff overrides to operators;
 * LuckPerms can override either way.
 */
final class QolPermissions {

  static final String PREFIX = "thestorm.qol.";
  static final String GRAVES = PREFIX + "graves";
  static final String GRAVES_ADMIN = PREFIX + "graves.admin";
  static final String SORT = PREFIX + "sort";

  private final PluginManager plugins;
  private final List<Permission> registered = new ArrayList<>();

  QolPermissions(PluginManager plugins) {
    this.plugins = plugins;
  }

  void register() {
    add(GRAVES, "Use /graves to list your graves", PermissionDefault.TRUE);
    add(GRAVES_ADMIN, "Open any grave, even while it is locked", PermissionDefault.OP);
    add(SORT, "Sort containers with /sort or a sneaking punch", PermissionDefault.TRUE);
  }

  void unregister() {
    registered.forEach(plugins::removePermission);
    registered.clear();
  }

  private void add(String name, String description, PermissionDefault byDefault) {
    var permission = new Permission(name, description, byDefault);
    plugins.addPermission(permission);
    registered.add(permission);
  }
}
