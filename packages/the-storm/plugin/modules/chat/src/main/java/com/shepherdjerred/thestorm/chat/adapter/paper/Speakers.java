package com.shepherdjerred.thestorm.chat.adapter.paper;

import com.shepherdjerred.thestorm.chat.domain.Speaker;
import org.bukkit.entity.Player;
import org.bukkit.permissions.Permissible;

/** Chat permissions and how a Paper player becomes a {@link Speaker}. */
final class Speakers {

  /** Talk in and receive staff chat; cannot be ignored. */
  static final String STAFF = "thestorm.chat.staff";

  /** Skip the caps and repeat limits. */
  static final String BYPASS_FILTERS = "thestorm.chat.bypass";

  /** Use {@code /mute} and {@code /unmute}. */
  static final String MUTE = "thestorm.chat.mute";

  private Speakers() {}

  static Speaker of(Player player) {
    return new Speaker(
        player.getUniqueId(),
        player.getName(),
        isStaff(player),
        player.hasPermission(BYPASS_FILTERS));
  }

  static boolean isStaff(Permissible permissible) {
    return permissible.hasPermission(STAFF);
  }
}
