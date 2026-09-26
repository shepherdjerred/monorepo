package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.shops.domain.shop.ShopLimits;
import com.shepherdjerred.thestorm.tracks.app.Track;
import java.util.function.IntPredicate;
import org.bukkit.entity.Player;
import org.bukkit.permissions.Permission;
import org.bukkit.permissions.PermissionDefault;
import org.bukkit.plugin.PluginManager;

/**
 * Every permission the shops check, registered at enable with an explicit default. The server owner
 * is an op who plays as a normal player, so nothing that changes the game for its holder is granted
 * to ops by default: those come only from LuckPerms groups.
 *
 * <ul>
 *   <li>{@link #ADMIN} (false): make admin shops, open and break anyone's shop, sneak-break shop
 *       signs.
 *   <li>{@link #OPEN_CATALOG} (op): the staff command {@code /shop <catalog>} and the list of
 *       closed admin shops.
 *   <li>Shopkeeper levels (false): owned by the tracks module; registered here too if tracks has
 *       not, so an unregistered node never falls back to ops.
 * </ul>
 */
public final class ShopsPermissions {

  /** Admin shops and the shop-lock bypass. A gameplay capability: never granted to ops. */
  public static final String ADMIN = "thestorm.shops.admin";

  /** The staff command that opens any NPC shop without its NPC, for testing. */
  public static final String OPEN_CATALOG = "thestorm.shops.command.open";

  private ShopsPermissions() {}

  /** Registers every node with its default, skipping Shopkeeper nodes tracks already registered. */
  public static void register(PluginManager plugins) {
    addIfAbsent(
        plugins,
        new Permission(
            ADMIN, "Make admin shops and open or break any shop", PermissionDefault.FALSE));
    addIfAbsent(
        plugins,
        new Permission(
            OPEN_CATALOG, "Open any NPC shop with /shop <catalog>", PermissionDefault.OP));
    for (var level = 1; level <= Track.MAX_LEVEL; level++) {
      addIfAbsent(
          plugins,
          new Permission(
              Track.SHOPKEEPER.permission(level),
              "Shopkeeper level " + level,
              PermissionDefault.FALSE));
    }
  }

  /** Nodes survive a plugin reload, and tracks registers the Shopkeeper ones first. */
  private static void addIfAbsent(PluginManager plugins, Permission permission) {
    if (plugins.getPermission(permission.getName()) == null) {
      plugins.addPermission(permission);
    }
  }

  /** A player's Shopkeeper level, from the track permissions. */
  public static int shopkeeperLevel(Player player) {
    IntPredicate has = level -> player.hasPermission(Track.SHOPKEEPER.permission(level));
    return ShopLimits.highestLevel(has);
  }
}
