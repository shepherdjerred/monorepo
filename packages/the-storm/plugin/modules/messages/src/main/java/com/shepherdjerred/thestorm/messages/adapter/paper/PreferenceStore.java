package com.shepherdjerred.thestorm.messages.adapter.paper;

import com.shepherdjerred.thestorm.messages.domain.AnnouncementPreferences;
import com.shepherdjerred.thestorm.messages.domain.Channel;
import java.util.EnumSet;
import java.util.Locale;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/**
 * Keeps each player's muted announcement channels in their persistent data container, so the choice
 * survives restarts without a database. Only a mute is stored; hearing is the absence of one.
 */
public final class PreferenceStore {

  private final Plugin plugin;

  public PreferenceStore(Plugin plugin) {
    this.plugin = plugin;
  }

  /** The player's current preferences. */
  public AnnouncementPreferences read(Player player) {
    var container = player.getPersistentDataContainer();
    var muted = EnumSet.noneOf(Channel.class);
    for (var channel : Channel.values()) {
      if (container.has(key(channel), PersistentDataType.BOOLEAN)) {
        muted.add(channel);
      }
    }
    return new AnnouncementPreferences(muted);
  }

  /** Flips {@code channel} for the player and returns the new preferences. */
  public AnnouncementPreferences toggle(Player player, Channel channel) {
    var next = read(player).toggle(channel);
    var container = player.getPersistentDataContainer();
    if (next.hears(channel)) {
      container.remove(key(channel));
    } else {
      container.set(key(channel), PersistentDataType.BOOLEAN, true);
    }
    return next;
  }

  private NamespacedKey key(Channel channel) {
    return new NamespacedKey(plugin, "messages-muted-" + channel.name().toLowerCase(Locale.ROOT));
  }
}
