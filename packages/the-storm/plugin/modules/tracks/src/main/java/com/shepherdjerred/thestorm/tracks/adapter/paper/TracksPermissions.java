package com.shepherdjerred.thestorm.tracks.adapter.paper;

import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.domain.Wording;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.permissions.Permission;
import org.bukkit.permissions.PermissionDefault;
import org.bukkit.plugin.PluginManager;

/**
 * The tracks' permissions, registered with explicit defaults: an unregistered node defaults to
 * operators, which would make every operator a level V player in every track.
 *
 * <p>Track levels ({@link Track#permission(int)}) default to nobody, operators included; they come
 * only from the LuckPerms track groups this module manages. The admin commands default to
 * operators. {@code /perks} itself checks no permission.
 */
public final class TracksPermissions {

  private final PluginManager plugins;
  private final List<Permission> registered = new ArrayList<>();

  public TracksPermissions(PluginManager plugins) {
    this.plugins = plugins;
  }

  /** Registers every track level and the admin permission. */
  public void register() {
    add(
        PerksAdminCommands.ADMIN_PERMISSION,
        "Use /perks admin set and /perks admin reset",
        PermissionDefault.OP);
    for (var track : Track.values()) {
      for (var level = 1; level <= Track.MAX_LEVEL; level++) {
        add(
            track.permission(level),
            "Has reached level " + Wording.numeral(level) + " in the " + track.id() + " track",
            PermissionDefault.FALSE);
      }
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
