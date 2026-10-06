package com.shepherdjerred.thestorm.core.players;

import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.persistence.PersistentDataType;

/** Player-data-backed hidden state shared by command, announcement and Discord surfaces. */
public final class PlayerVisibility {
  public static final String SEE = "thestorm.essentials.vanish.see";
  private static final NamespacedKey KEY = new NamespacedKey("thestorm", "vanished");
  private static final java.util.Set<java.util.UUID> HIDDEN =
      java.util.concurrent.ConcurrentHashMap.newKeySet();
  private static final java.util.concurrent.ConcurrentMap<java.util.UUID, Long>
      PENDING_JOIN_ANNOUNCEMENTS = new java.util.concurrent.ConcurrentHashMap<>();
  private static final java.util.concurrent.atomic.AtomicLong JOIN_ANNOUNCEMENT_SEQUENCE =
      new java.util.concurrent.atomic.AtomicLong();
  private static volatile boolean restored;

  private PlayerVisibility() {}

  public static boolean hidden(Player player) {
    return player.getPersistentDataContainer().has(KEY, PersistentDataType.BYTE);
  }

  public static boolean visibleTo(org.bukkit.command.CommandSender viewer, Player target) {
    return !hidden(target) || viewer.equals(target) || viewer.hasPermission(SEE);
  }

  public static void set(Player player, boolean hidden) {
    restore(player.getUniqueId(), hidden);
    if (hidden) player.getPersistentDataContainer().set(KEY, PersistentDataType.BYTE, (byte) 1);
    else player.getPersistentDataContainer().remove(KEY);
  }

  public static void restore(java.util.UUID player, boolean hidden) {
    if (hidden) HIDDEN.add(player);
    else HIDDEN.remove(player);
  }

  public static boolean hidden(java.util.UUID player) {
    return HIDDEN.contains(player);
  }

  public static long deferJoinAnnouncement(java.util.UUID player) {
    var token = JOIN_ANNOUNCEMENT_SEQUENCE.incrementAndGet();
    PENDING_JOIN_ANNOUNCEMENTS.put(player, token);
    return token;
  }

  public static boolean joinAnnouncementPending(Player player) {
    return PENDING_JOIN_ANNOUNCEMENTS.containsKey(player.getUniqueId());
  }

  public static boolean resolveJoinAnnouncement(java.util.UUID player, long token) {
    return PENDING_JOIN_ANNOUNCEMENTS.remove(player, token);
  }

  /** Whether persisted hidden-player state has been restored from the staff store. */
  public static boolean restored() {
    return restored;
  }

  public static void markRestored() {
    restored = true;
  }
}
