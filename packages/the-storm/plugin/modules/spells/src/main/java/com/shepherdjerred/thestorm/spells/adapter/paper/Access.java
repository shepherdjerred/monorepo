package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.spells.app.SpellScrolls;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.tracks.app.Track;
import org.bukkit.permissions.Permissible;

/**
 * Reads a player's access from permissions: their Spellcaster level (the tracks module grants
 * {@code thestorm.track.spellcaster.<level>} and every lower level) and the quest-only spells they
 * have learned ({@code thestorm.spells.learned.<id>}).
 */
final class Access {

  /** Gives, takes and rebinds any spell item; lists every spell. */
  static final String ADMIN = "thestorm.spells.admin";

  private Access() {}

  /** The player's Spellcaster level, 0 (untrained) to 5. */
  static int tier(Permissible player) {
    for (var level = Track.MAX_LEVEL; level >= 1; level--) {
      if (player.hasPermission(Track.SPELLCASTER.permission(level))) {
        return level;
      }
    }
    return 0;
  }

  static boolean learned(Permissible player, SpellKind spell) {
    return player.hasPermission(SpellScrolls.learnedPermission(spell.id()));
  }
}
