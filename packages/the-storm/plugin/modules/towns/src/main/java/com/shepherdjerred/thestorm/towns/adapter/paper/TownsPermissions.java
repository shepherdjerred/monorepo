package com.shepherdjerred.thestorm.towns.adapter.paper;

import org.bukkit.permissions.Permission;
import org.bukkit.permissions.PermissionDefault;
import org.bukkit.plugin.PluginManager;

/** Lock permissions. Unregistered nodes would default to operators, so these are explicit. */
final class TownsPermissions {

  static final String ADMIN = "thestorm.towns.lock.admin";

  private TownsPermissions() {}

  static void register(PluginManager plugins) {
    add(
        plugins,
        new Permission(ADMIN, "Expire, purge, find and reassign locks", PermissionDefault.FALSE));
    add(
        plugins,
        new Permission(
            LockFee.FREE,
            "Lock a container without paying the crystal cost",
            PermissionDefault.FALSE));
  }

  private static void add(PluginManager plugins, Permission permission) {
    if (plugins.getPermission(permission.getName()) == null) {
      plugins.addPermission(permission);
    }
  }
}
