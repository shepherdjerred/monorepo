package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Lane;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Passages;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Playbook;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Slot;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;

/**
 * Where a bot walks to its work and at what pace: a slot's point and goal, and the stance of a
 * route to a slot, a bomb, or a hunt.
 */
final class SlotRoutes {

  private SlotRoutes() {}

  /**
   * The pace to a slot: a run, except that a cut-lane pair waiting at its mouth walks so the main
   * push is what the other team sees first, and the last living bot sneaks.
   */
  static Stance slotStance(Situation situation, TacticsContext context, Slot slot) {
    if (situation.isLastAlive()) {
      return Stance.STEALTH;
    }
    var waiting =
        situation
            .board()
            .plan()
            .laneOf(slot)
            .filter(Lane::cut)
            .filter(
                cut -> slot.kind() != SlotKind.ANCHOR && Passages.waiting(situation, context, cut))
            .isPresent();
    return waiting ? Stance.CAUTIOUS : Stance.AGGRESSIVE;
  }

  static Stance stanceFor(Situation situation, TacticsContext context) {
    if (situation.isLastAlive()) {
      return Stance.STEALTH;
    }
    return context.style().aggression() > 0.6 ? Stance.AGGRESSIVE : Stance.CAUTIOUS;
  }

  /** A helper walks to the bomb; anyone else goes at the pace of their temper. */
  static Stance bombStance(Option option, Situation situation, TacticsContext context) {
    return option == Option.HELP_ARM ? Stance.CAUTIOUS : stanceFor(situation, context);
  }

  static Vec3 slotPoint(Situation situation, TacticsContext context, Slot slot) {
    if (Planner.poisonDanger(situation, slot.pos(), Planner.POISON_MARGIN)) {
      return Planner.poisonExit(situation, context);
    }
    if (slot.kind() != SlotKind.ESCORT) {
      return slot.pos();
    }
    if (slot.buddy().isPresent()) {
      return Accompany.point(situation, context, slot);
    }
    var planter = situation.planter();
    if (planter.isEmpty()) {
      return slot.pos();
    }
    var from = planter.orElseThrow().pos();
    var heading =
        situation
            .board()
            .plan()
            .objective()
            .flatMap(situation.snapshot()::bomb)
            .map(BombView::pos)
            .orElseGet(slot::watch)
            .minus(from)
            .horizontal();
    if (heading.isZero()) {
      return slot.pos();
    }
    var point = Playbook.escortPoint(from, heading.normalized(), slot.side());
    var graph = context.nav().graph();
    var node = graph.nearestNodeWithin(point, Planner.SNAP);
    return node.isPresent() ? graph.feet(node.getAsInt()) : point;
  }

  /**
   * Where a slot is walked to. A cut pair stages at the mouth until the main push is seen. A quiet
   * cut anchor returns to the home bomb. A team waiting out another fight stands off that fight.
   */
  static Vec3 goal(Situation situation, TacticsContext context, Slot slot) {
    var posted = situation.board().plan().laneOf(slot);
    if (posted.isPresent() && posted.orElseThrow().cut()) {
      var lane = posted.orElseThrow();
      if (slot.kind() == SlotKind.ANCHOR && Passages.quiet(situation, lane)) {
        var home = Passages.homeBomb(situation);
        if (home.isPresent()) {
          return home.orElseThrow();
        }
      } else if (slot.kind() != SlotKind.ANCHOR && Passages.waiting(situation, context, lane)) {
        return lane.at(Passages.MOUTH);
      }
    }
    if (slot.kind() != SlotKind.ANCHOR
        && slot.kind() != SlotKind.OVERWATCH
        && slot.kind() != SlotKind.PLANT) {
      var edge = Passages.edge(situation);
      if (edge.isPresent()) {
        return edge.orElseThrow();
      }
    }
    return slotPoint(situation, context, slot);
  }
}
