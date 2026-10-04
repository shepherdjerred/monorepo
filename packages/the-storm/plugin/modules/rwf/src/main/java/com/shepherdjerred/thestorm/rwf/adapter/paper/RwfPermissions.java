package com.shepherdjerred.thestorm.rwf.adapter.paper;

import java.util.ArrayList;
import java.util.List;
import org.bukkit.permissions.Permission;
import org.bukkit.permissions.PermissionDefault;
import org.bukkit.plugin.PluginManager;

/** The module's permissions: playing is open to everyone; the admin tools are for operators. */
final class RwfPermissions {

  static final String PLAY = "thestorm.rwf.play";
  static final String ADMIN = "thestorm.rwf.admin";

  private final PluginManager manager;
  private final List<Permission> registered = new ArrayList<>();

  RwfPermissions(PluginManager manager) {
    this.manager = manager;
  }

  void register() {
    add(PLAY, "Join, leave and play Search and Destroy", PermissionDefault.TRUE);
    add(
        ADMIN,
        "Inspect, repair and load-test Search and Destroy, and enter its world freely",
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
