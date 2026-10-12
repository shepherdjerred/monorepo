// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/combat/CombatLog.java and
// redwarfare-arcade/src/me/libraryaddict/arcade/game/Game.java, onKillstreakDeath); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.combat;

import java.time.Duration;
import java.time.Instant;

/**
 * The newest member hit in a victim's combat log, which earns the kill when the rules kill them (a
 * bomb has no attacker). Red Warfare pruned the log each time new damage was logged, while the
 * victim stood on the ground: walking from the newest entry back, the health still missing after
 * the newer entries' damage is accounted for; an entry older than {@link #MEMORY} is dropped once
 * none is left missing, so a hit the victim has since healed from stops counting, for good.
 *
 * @param at when the member hit
 * @param damageSince the damage logged after it, from the world (newer member hits replace it)
 */
public record KillCredit(Instant at, double damageSince) {

  /** How old a healed hit must be before it is dropped. */
  public static final Duration MEMORY = Duration.ofSeconds(10);

  /** A member hit landing at {@code at}. */
  public static KillCredit hit(Instant at) {
    return new KillCredit(at, 0);
  }

  /** {@code damage} from the world was logged after the hit. */
  public KillCredit hurt(double damage) {
    return new KillCredit(at, damageSince + damage);
  }

  /**
   * Whether the log drops this hit when new damage is logged at {@code now} for a victim missing
   * {@code missingHealth} who is {@code grounded}.
   */
  public boolean pruned(Instant now, double missingHealth, boolean grounded) {
    return grounded && missingHealth - damageSince <= 0.01 && now.isAfter(at.plus(MEMORY));
  }
}
