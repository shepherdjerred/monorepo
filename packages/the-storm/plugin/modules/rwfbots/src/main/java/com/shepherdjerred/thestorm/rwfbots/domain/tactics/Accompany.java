package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Slot;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;

/**
 * Where a support slot ({@link com.shepherdjerred.thestorm.rwfbots.domain.team.HumanSupport})
 * stands now: beside the human it accompanies, its {@link Slot#side} blocks to one side and a step
 * ahead of them towards what the slot watches, so it moves with them instead of staying where they
 * stood when it was dealt.
 */
final class Accompany {

  /** How far ahead of the human a support slot stands, towards what it watches. */
  static final double AHEAD = 1.5;

  private Accompany() {}

  /** The walkable point beside {@code slot}'s human, or the slot's own point once they are gone. */
  static Vec3 point(Situation situation, TacticsContext context, Slot slot) {
    var human = slot.buddy().flatMap(situation.snapshot()::combatant).filter(CombatantView::alive);
    if (human.isEmpty()) {
      return slot.pos();
    }
    var from = human.orElseThrow().pos();
    var heading = slot.watch().minus(from).horizontal();
    if (heading.isZero()) {
      return from;
    }
    var forward = heading.normalized();
    var point =
        from.plus(forward.scale(AHEAD))
            .plus(new Vec3(-forward.z(), 0, forward.x()).scale(slot.side()));
    var graph = context.nav().graph();
    var node = graph.nearestNodeWithin(point, Planner.SNAP);
    return node.isPresent() ? graph.feet(node.getAsInt()) : from;
  }
}
