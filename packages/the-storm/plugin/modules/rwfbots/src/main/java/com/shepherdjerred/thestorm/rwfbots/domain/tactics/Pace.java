package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.map.RouteResult;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import java.util.Optional;

/**
 * How a step that is not a fight moves the bot, which bounds how far away it takes on a target. A
 * sword only ever takes an enemy close enough to swing at, so holding a slot never turns into a
 * charge.
 */
enum Pace {
  /** Holding a spot: a bow takes any visible enemy inside its band. */
  STILL,
  /**
   * Walking a route or patrol: a bow takes an enemy inside the near edge of its band, drawing as it
   * walks, as {@link Utilities} only fights from there on the way to a slot. Bows used to be held
   * to sword reach whenever the step moved, so an archer walking its route never shot.
   */
  MOVING,
  /** Running for cover or away: drawing slows the bot to a walk, and getting there comes first. */
  DASHING,
  /** Sneaking as the last of its team: it takes on nobody. */
  HIDING;

  /** The pace of a route walked at {@code stance}; a bound runs from cover to cover. */
  static Pace route(Stance stance, boolean bounding) {
    return switch (stance) {
      case STEALTH -> HIDING;
      case EVASIVE -> DASHING;
      case AGGRESSIVE, CAUTIOUS -> bounding ? DASHING : MOVING;
    };
  }

  /** The pace of a hold: still once there, walking back to it or about a patrol. */
  static Pace hold(PlanStep.Hold hold, RouteResult route) {
    return hold.stance() == Stance.EVASIVE ? DASHING : of(route);
  }

  /** The pace of a cover step: running to it, still in it. */
  static Pace cover(boolean inCover) {
    return inCover ? STILL : DASHING;
  }

  /** Still when arrived, otherwise walking. */
  static Pace of(RouteResult route) {
    return route instanceof RouteResult.Arrived ? STILL : MOVING;
  }

  /** The visible enemy a bot at this pace aims at, if any. */
  Optional<CombatantId> target(Situation situation, TacticsContext context) {
    var keep = context.keep();
    var reach =
        switch (this) {
          case HIDING -> -1;
          case DASHING -> Planner.CLOSE_FIGHT;
          case MOVING -> keep.ranged() ? keep.min() : Planner.CLOSE_FIGHT;
          case STILL -> keep.ranged() ? keep.max() : Planner.CLOSE_FIGHT;
        };
    return situation
        .percept()
        .nearestVisible()
        .filter(view -> view.pos().distance(situation.self().pos()) <= reach)
        .map(CombatantView::id);
  }
}
