package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.KitCombat;
import java.util.UUID;
import org.bukkit.entity.Entity;
import org.bukkit.util.Vector;

/**
 * A kit's knockback share (the Juggernaut's 0.8) for a pushed fighter. Red Warfare scaled every
 * velocity a player was sent, which for a human is only ever a push. A bot body is steered by
 * setting its velocity every tick, so scaling that cut every Juggernaut bot's jump short of a block
 * and its walk by a fifth; for a bot the share is applied where a push lands instead.
 */
final class KnockbackShare {
  private KnockbackShare() {}

  /** Whether {@code player}'s velocity events are its own steering rather than pushes. */
  static boolean steered(MatchRunner runner, UUID player) {
    return runner.memberOf(player).filter(member -> member.id().isBot()).isPresent();
  }

  /** {@code push} as it lands on {@code entity}: scaled by its kit's share when it is a bot. */
  static Vector landing(MatchRunner runner, Entity entity, Vector push) {
    if (!runner.fighting(entity.getUniqueId()) || !steered(runner, entity.getUniqueId())) {
      return push;
    }
    return runner
        .kits()
        .side(entity.getUniqueId())
        .map(side -> push.clone().multiply(KitCombat.knockback(side.kit())))
        .orElse(push);
  }
}
