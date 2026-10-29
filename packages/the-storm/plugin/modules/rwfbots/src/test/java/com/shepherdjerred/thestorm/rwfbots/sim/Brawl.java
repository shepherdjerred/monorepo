package com.shepherdjerred.thestorm.rwfbots.sim;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Small fights in the headless sim under rwf's 1.8 combat ({@link SimWorld.Combat#RWF}): bots with
 * their whole brain against each other or against a scripted rusher, a plain player who runs
 * straight at its target and swings whenever the hit window lets a blow land.
 */
final class Brawl {

  /** A rusher swings this many ticks after the hit window reopens, at most. */
  private static final int RUSHER_SLACK = 4;

  /** A rusher stops pressing in this close, as a player stops walking into its enemy. */
  private static final double RUSHER_STOP = 1.6;

  private Brawl() {}

  /** An empty sim on {@code nav} under rwf's rules. */
  static SimWorld world(NavArtifact nav, long seed) {
    var world = new SimWorld(nav, seed);
    world.combat = SimWorld.Combat.RWF;
    return world;
  }

  /** Turns {@code body} to face {@code other}, brain and all, as at the start of a fight. */
  static void face(SimBody body, SimBody other) {
    body.look = Facing.looking(body.pos.plus(0, 1.62, 0), other.pos.plus(0, 1.3, 0));
    body.reflex = ReflexState.initial(body.look);
  }

  /**
   * One tick of a rusher: it sprints at {@code target}, looks at its chest and swings once the
   * window reopens, a few ticks late at random. Called before {@link SimWorld#step}.
   */
  static void rush(SimWorld world, SimBody rusher, SimBody target) {
    if (!rusher.alive || !target.alive) {
      rusher.moveTarget = Optional.empty();
      return;
    }
    rusher.look = Facing.looking(rusher.pos.plus(0, 1.62, 0), target.pos.plus(0, 1.3, 0));
    var distance = rusher.pos.horizontalDistance(target.pos);
    rusher.sprinting = true;
    rusher.moveTarget = distance > RUSHER_STOP ? Optional.of(target.pos) : Optional.empty();
    if (distance > RUSHER_STOP) rusher.heading = target.pos.minus(rusher.pos);
    var reopens = target.lastHurt < 0 ? 0 : target.lastHurt + SimWorld.RWF_HIT_WINDOW_TICKS;
    if (world.tick + 1 >= reopens + world.random.nextInt(RUSHER_SLACK + 1)) {
      world.apply(rusher, new BodyCommand.Attack(target.id));
    }
  }

  /** How one fight ended. */
  record Outcome(List<SimBody.Death> deaths, long ticks) {}

  /**
   * Steps {@code world} until a side is down or {@code limit} ticks pass. A body that falls below
   * the map's lowest ground dies to the void at once rather than after the long fall.
   */
  static Outcome fight(SimWorld world, int limit, Runnable beforeStep) {
    var start = world.tick;
    while (world.tick - start < limit && !decided(world)) {
      beforeStep.run();
      world.step();
      for (var body : world.bodies.values()) {
        if (body.alive && body.pos.y() < world.nav.graph().bounds().origin().y() - 2) {
          body.hurt(1000, world.tick, SimBody.Cause.VOID);
        }
      }
    }
    var deaths = new ArrayList<SimBody.Death>();
    for (var body : world.bodies.values()) body.death.ifPresent(deaths::add);
    return new Outcome(deaths, world.tick - start);
  }

  /** Whether a side has nobody left alive. */
  static boolean decided(SimWorld world) {
    return world.bodies.values().stream().map(body -> body.team).distinct().count()
        > world.bodies.values().stream()
            .filter(body -> body.alive)
            .map(body -> body.team)
            .distinct()
            .count();
  }
}
