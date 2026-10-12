// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/combat/CombatLog.java and
// redwarfare-arcade/src/me/libraryaddict/arcade/game/Game.java, onKillstreakDeath); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.combat;

import java.time.Duration;
import java.time.Instant;

/**
 * Who is credited when the rules kill a player, as a bomb does. The bomb itself has no attacker, so
 * Red Warfare credited the kill to the last player who hurt the victim while that hit was still in
 * the victim's combat log: a hit stayed there until the victim had healed back to full health and
 * {@link #MEMORY} had passed.
 */
public final class KillCredit {

  /** How long a hit is remembered once the victim is back to full health. */
  public static final Duration MEMORY = Duration.ofSeconds(10);

  private KillCredit() {}

  /**
   * Whether a hit landed at {@code hitAt} still earns the kill at {@code now}, for a victim at
   * {@code health} of {@code maxHealth}.
   */
  public static boolean counts(Instant hitAt, Instant now, double health, double maxHealth) {
    var healed = maxHealth - health <= 0.01;
    return !healed || !now.isAfter(hitAt.plus(MEMORY));
  }
}
