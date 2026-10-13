// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/GhostAbility.java,
// onUpdate); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.KitText;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.entity.Player;

/**
 * Arrows falling out of a ghost ten seconds after they hit, as Red Warfare let them: the body's own
 * arrow timer is held back, one arrow goes, and the ghost is told how many remain. Once none
 * remain, the arrows still queued for that ghost are forgotten, as Red Warfare dropped them from
 * its queue. Main thread only.
 */
final class GhostArrows {

  /** Red Warfare's {@code setArrowDespawnTimer(player, 500)}, in ticks. */
  static final int HOLD_TICKS = 500;

  /** For each ghost, the hits whose arrows are forgotten: those at or before this. */
  private final Map<UUID, Instant> forgotten = new HashMap<>();

  /** The arrow that hit {@code ghost} at {@code hit} falls out at {@code now}. */
  void unstick(Player ghost, Instant hit, Instant now) {
    var before = forgotten.get(ghost.getUniqueId());
    if (before != null && !hit.isAfter(before)) {
      return;
    }
    ghost.setArrowCooldown(HOLD_TICKS);
    var arrows = ghost.getArrowsInBody() - 1;
    var message =
        arrows > 0
            ? "You have " + arrows + " arrow" + (arrows == 1 ? "" : "s") + " stuck in you!"
            : "No remaining arrows stuck in you!";
    Classic.say(
        ghost,
        KitText.AQUA
            + KitText.MAGIC
            + "sd "
            + KitText.AQUA
            + "An arrow has disappeared.. "
            + message);
    ghost.setArrowsInBody(Math.max(0, arrows), false);
    if (arrows <= 0) {
      forgotten.put(ghost.getUniqueId(), now);
    }
  }

  /** {@code ghost} left the match: nothing is remembered of it. */
  void forget(UUID ghost) {
    forgotten.remove(ghost);
  }

  /** The match reset. */
  void clear() {
    forgotten.clear();
  }
}
