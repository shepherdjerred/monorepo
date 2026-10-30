package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;

/**
 * How hard a bot presses a sword fight. In production bots within 3.5 blocks of their enemy closed
 * on it at 0.3 blocks a second against a human's 1.3, and were backing off on a quarter of their
 * swings: they held a band 2.6 to 2.9 blocks off and backed out of it whenever the enemy came in.
 * Under rwf's 1.8 rules the fighter in reach when the hit window reopens lands the blow, so a bot
 * now leans in between swings, sprinting so the blow is a sprint hit, and gives ground only when it
 * is badly hurt or outnumbered, or a teammate is on top of the fight.
 */
final class MeleePressure {

  /** How hard a bot leans in from inside the band. */
  static final double CLOSE_LEAN = 0.0;

  /** How hard a bot presses in the band. */
  static final double BAND_LEAN = 0.5;

  /** How hard a bot backs off when it gives ground. */
  static final double BACK_OFF = -0.6;

  /** A bot at or under this share of its maximum health may give ground. */
  static final double HURT_SHARE = 0.3;

  /** Enemies and teammates within this many blocks count towards being outnumbered. */
  static final double NEAR = 6;

  private MeleePressure() {}

  /**
   * How hard to close on a target {@code distance} off: in to the band from outside it; inside it,
   * lean in, or when the bot {@code yields}, hold the band and back out of it; back off when a
   * teammate is {@code crowded} on top of the fight, to give it room rather than pile in. Where the
   * ground is {@code ledged} ({@link EdgeFooting}) it keeps the band as a bot that yields does:
   * pressing there traded blows that carried bots off a bridge twice as often, and the edge
   * footwork leans in on its own where a drop is behind it.
   */
  static double closing(double distance, boolean crowded, boolean yields, boolean ledged) {
    if (crowded) return BACK_OFF;
    if (distance > Reflex.SPACING_FAR) return 1.0;
    if (yields || ledged) return distance < Reflex.SPACING_NEAR ? BACK_OFF : 0.0;
    return distance < Reflex.SPACING_NEAR ? CLOSE_LEAN : BAND_LEAN;
  }

  /** Whether the bot may give ground: badly hurt, or more enemies than teammates around it. */
  static boolean yields(ReflexInput input) {
    var self = input.self();
    if (self.effectiveHealth() <= HURT_SHARE * self.traversal().maxHealth()) return true;
    var enemies = input.perceived().stream().filter(enemy -> near(self, enemy)).count();
    // The bot is among its own team's living members.
    var allies =
        input.snapshot().alive(self.team()).stream().filter(ally -> near(self, ally)).count();
    return enemies > allies;
  }

  private static boolean near(CombatantView self, CombatantView other) {
    return other.pos().distance(self.pos()) <= NEAR;
  }

  /**
   * The state with its next swing pulled in to a reaction time after a blow the bot took this tick
   * or last: a player struck swings back rather than waiting out its click rhythm.
   */
  static ReflexState answer(ReflexState state, CombatantView self, long now, int reactionTicks) {
    if (self.lastHurtTick() < 0 || now - self.lastHurtTick() > 1) return state;
    var answer = (double) self.lastHurtTick() + reactionTicks;
    return state.nextClickAt() > answer ? state.withClick(answer, state.wTapUntil()) : state;
  }
}
