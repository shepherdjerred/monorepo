package com.shepherdjerred.thestorm.essentials.adapter.paper;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import org.bukkit.permissions.Permission;
import org.bukkit.permissions.PermissionDefault;
import org.bukkit.plugin.PluginManager;

/**
 * Essentials' permissions. Player commands default to everyone and staff commands to operators;
 * LuckPerms can override either way.
 */
public final class EssentialsPermissions {

  static final String PREFIX = "thestorm.essentials.";
  static final String SPAWN = PREFIX + "spawn";
  static final String HOME = PREFIX + "home";
  static final String TPA = PREFIX + "tpa";
  static final String BACK = PREFIX + "back";
  static final String WARP = PREFIX + "warp";
  static final String SET_WARP = PREFIX + "setwarp";
  static final String KIT = PREFIX + "kit";
  static final String RULES = PREFIX + "rules";
  static final String AFK = PREFIX + "afk";
  static final String KICK = PREFIX + "kick";
  static final String BAN = PREFIX + "ban";
  static final String KICK_EXEMPT = PREFIX + "kick.exempt";
  static final String BAN_EXEMPT = PREFIX + "ban.exempt";
  static final String HISTORY = PREFIX + "history";
  static final String TELEPORT_FREE = PREFIX + "teleport.free";
  static final String TELEPORT_NO_COOLDOWN = PREFIX + "teleport.nocooldown";

  private final PluginManager plugins;
  private final List<Permission> registered = new ArrayList<>();

  public EssentialsPermissions(PluginManager plugins) {
    this.plugins = plugins;
  }

  /** The permission to claim the kit called {@code name}. */
  static String kit(String name) {
    return KIT + "." + name;
  }

  /**
   * Registers every permission, including one per kit: the starter kit is open to everyone, every
   * other kit must be granted.
   */
  public void register(Collection<String> kitNames, String starterKit) {
    add(SPAWN, "Use /spawn", PermissionDefault.TRUE);
    add(HOME, "Use /home, /sethome, /delhome and /homes", PermissionDefault.TRUE);
    add(TPA, "Use /tpa, /tpahere, /tpaccept, /tpdeny and /tptoggle", PermissionDefault.TRUE);
    add(BACK, "Use /back", PermissionDefault.TRUE);
    add(WARP, "Use /warp", PermissionDefault.TRUE);
    add(KIT, "Use /kit", PermissionDefault.TRUE);
    add(RULES, "Use /rules", PermissionDefault.TRUE);
    add(AFK, "Use /afk", PermissionDefault.TRUE);
    add(SET_WARP, "Use /setwarp and /delwarp", PermissionDefault.OP);
    add(KICK, "Use /kick", PermissionDefault.OP);
    add(BAN, "Use /ban, /tempban, /unban, /pardon and /banlist", PermissionDefault.OP);
    add(HISTORY, "Use /history", PermissionDefault.OP);
    add(KICK_EXEMPT, "Cannot be kicked", PermissionDefault.OP);
    add(BAN_EXEMPT, "Cannot be banned", PermissionDefault.OP);
    add(TELEPORT_FREE, "Teleport without paying", PermissionDefault.OP);
    add(TELEPORT_NO_COOLDOWN, "Teleport without cooldowns", PermissionDefault.OP);
    for (var name : kitNames) {
      var byDefault = name.equals(starterKit) ? PermissionDefault.TRUE : PermissionDefault.OP;
      add(kit(name), "Claim the " + name + " kit", byDefault);
    }
  }

  /** Removes everything {@link #register} added. */
  public void unregister() {
    registered.forEach(plugins::removePermission);
    registered.clear();
  }

  private void add(String name, String description, PermissionDefault byDefault) {
    var permission = new Permission(name, description, byDefault);
    plugins.addPermission(permission);
    registered.add(permission);
  }
}
