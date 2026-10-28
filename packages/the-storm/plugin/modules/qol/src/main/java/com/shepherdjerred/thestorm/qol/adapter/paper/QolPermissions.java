package com.shepherdjerred.thestorm.qol.adapter.paper;

import java.util.ArrayList;
import java.util.Collection;
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
  static final String SORT_MIDDLE = PREFIX + "sort.middle";
  static final String SORT_SHIFT = PREFIX + "sort.shift";
  static final String SORT_DOUBLE = PREFIX + "sort.double";
  static final String SORT_SHIFT_RIGHT = PREFIX + "sort.shift-right";
  static final String SORT_DUMP = PREFIX + "sort.dump";
  static final String SORT_TAKE = PREFIX + "sort.take";
  static final String SORT_LEFT = PREFIX + "sort.left-click";
  static final String BANK_CREATE = PREFIX + "bank.create";
  static final String BANK_ADD = PREFIX + "bank.add";
  static final String BANK_USE = PREFIX + "bank.use";
  static final String BANK_FIND = PREFIX + "bank.find";
  static final String BANK_ADMIN = PREFIX + "bank.admin";
  static final String BANK_RELOAD = PREFIX + "bank.reload";
  static final String BANK_UNLIMITED = PREFIX + "bank.unlimited";
  static final String BANK_CHECK = PREFIX + "bank.check";
  static final String BANK_LIMITS = PREFIX + "bank.limits.";

  private final PluginManager plugins;
  private final List<Permission> registered = new ArrayList<>();

  QolPermissions(PluginManager plugins) {
    this.plugins = plugins;
  }

  void register(Collection<String> bankGroups) {
    add(GRAVES, "Use /graves to list your graves", PermissionDefault.TRUE);
    // A bypass, so never given by default (not even to operators): grant it through LuckPerms.
    add(GRAVES_ADMIN, "Open any grave, even while it is locked", PermissionDefault.FALSE);
    add(SORT, "Open sorting settings and sort your inventory", PermissionDefault.TRUE);
    add(SORT_MIDDLE, "Sort by middle-clicking an empty slot", PermissionDefault.TRUE);
    add(SORT_SHIFT, "Sort by shift-clicking an empty slot", PermissionDefault.TRUE);
    add(SORT_DOUBLE, "Sort by double-clicking an empty slot", PermissionDefault.TRUE);
    add(SORT_SHIFT_RIGHT, "Sort by shift-right-clicking an empty slot", PermissionDefault.TRUE);
    add(SORT_DUMP, "Dump matching items into a container", PermissionDefault.TRUE);
    add(SORT_TAKE, "Take matching items out of a container", PermissionDefault.TRUE);
    add(SORT_LEFT, "Sort a container by left-clicking it", PermissionDefault.TRUE);
    add(BANK_CREATE, "Create a deposit bank", PermissionDefault.TRUE);
    add(BANK_ADD, "Link a shelf to a bank", PermissionDefault.TRUE);
    add(BANK_USE, "Deposit into a bank", PermissionDefault.TRUE);
    add(BANK_FIND, "Find items in nearby banks", PermissionDefault.TRUE);
    add(BANK_ADMIN, "Break, open or add to any bank", PermissionDefault.FALSE);
    add(BANK_RELOAD, "Reload banks from storage", PermissionDefault.OP);
    add(BANK_UNLIMITED, "Ignore the bank and shelf limits", PermissionDefault.FALSE);
    add(BANK_CHECK, "Drop banks whose blocks are gone", PermissionDefault.OP);
    for (var group : bankGroups) {
      add(BANK_LIMITS + group, "Use the " + group + " bank limits", PermissionDefault.FALSE);
    }
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
