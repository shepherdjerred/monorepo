package com.shepherdjerred.thestorm.rwfbots.domain.perception;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;

/**
 * Who last hurt the bot, for its aggro: for {@link #WINDOW_TICKS} after the latest hit the bot
 * treats that attacker as its preferred threat. Only the victim holds a grudge; teammates learn of
 * the fight the usual way, by hearing it.
 *
 * @param attacker who hit the bot
 * @param hitTick when the latest hit landed
 * @param anchor where the bot stood when this attacker first hit it in the current window: the
 *     centre of its leash, so a kiting attacker cannot drag the bot across the map hit by hit
 */
public record Grudge(CombatantId attacker, long hitTick, Vec3 anchor) {

  /** How long a hit keeps the attacker the bot's preferred threat, in ticks (seven seconds). */
  public static final long WINDOW_TICKS = 140;

  /** How far from {@link #anchor} the bot follows its attacker, in blocks. */
  public static final double LEASH = 22;

  public Grudge {
    if (hitTick < 0) {
      throw new IllegalArgumentException("tick must not be negative");
    }
  }

  /** Whether the latest hit is recent enough at {@code now} to hold the bot's attention. */
  public boolean activeAt(long now) {
    return now - hitTick <= WINDOW_TICKS;
  }

  /**
   * This grudge after {@code attacker} hit the bot standing at {@code at} on {@code tick}: the same
   * attacker hitting again within the window refreshes it and keeps the leash where it was, anyone
   * else (or a hit after the window) starts a new one.
   */
  public Grudge hitBy(CombatantId attacker, long tick, Vec3 at) {
    if (attacker.equals(this.attacker) && activeAt(tick)) {
      return new Grudge(attacker, Math.max(hitTick, tick), anchor);
    }
    return tick >= hitTick ? new Grudge(attacker, tick, at) : this;
  }
}
