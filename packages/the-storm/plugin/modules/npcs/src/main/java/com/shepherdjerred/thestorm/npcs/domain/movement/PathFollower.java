package com.shepherdjerred.thestorm.npcs.domain.movement;

import com.shepherdjerred.thestorm.npcs.domain.brain.Intent;
import com.shepherdjerred.thestorm.npcs.domain.brain.NpcBrain;
import com.shepherdjerred.thestorm.npcs.domain.geo.Rotation;
import com.shepherdjerred.thestorm.npcs.domain.geo.Vec3;
import com.shepherdjerred.thestorm.npcs.domain.movement.Walker.Phase;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcPose;
import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;

/**
 * Walks NPCs to where their {@link Intent} wants them, one tick at a time.
 *
 * <p>An NPC first asks the navigator for a path ({@link Phase.Planning}), then steps along its
 * waypoints at {@link MovementSettings#speed()} ({@link Phase.Following}), then rests ({@link
 * Phase.Resting}). It never gets lost for long: a navigator that finds no path, a path that keeps
 * ending short, or a step that makes no progress (the entity did not move, say because the next
 * chunk is unloaded) all end in a teleport to the destination.
 *
 * <p>Randomness (wander points and pauses) comes from the injected generator, so a seeded one
 * replays exactly.
 */
public final class PathFollower {

  /** How far above the feet the eyes are, for looking at players. */
  static final double EYE_HEIGHT = 1.62;

  /** Turns smaller than this, in degrees, are not worth sending. */
  static final float MIN_TURN = 2;

  private static final double PROGRESS_EPSILON = 1.0e-3;

  private final MovementSettings settings;
  private final RandomGenerator random;

  public PathFollower(MovementSettings settings, RandomGenerator random) {
    this.settings = settings;
    this.random = random;
  }

  /** Where an NPC stands and which way it faces. */
  public record At(Vec3 position, Rotation facing) {}

  /** The result of a tick: the next state and what to do to the entity, in order. */
  public record Tick(Walker walker, List<Move> moves) {

    public Tick {
      moves = List.copyOf(moves);
    }

    /** This tick with {@code first} done before its own moves. */
    Tick after(List<Move> first) {
      var all = new ArrayList<>(first);
      all.addAll(moves);
      return new Tick(walker, all);
    }
  }

  /** Starts {@code intent} from {@code at}. */
  public Tick start(Intent intent, At at, long now) {
    return depart(intent, 0, at, now);
  }

  /** Switches to {@code intent} if it differs from the current one; otherwise changes nothing. */
  public Tick retarget(Walker walker, Intent intent, At at, long now) {
    if (walker.intent().equals(intent)) {
      return new Tick(walker, List.of());
    }
    var release =
        walker.pathTarget().isPresent()
            ? List.<Move>of(new Move.ReleaseNavigator())
            : List.<Move>of();
    return depart(intent, 0, at, now).after(release);
  }

  /**
   * Turns an NPC standing at {@code at} to face eyes at {@code listener}, such as a player talking
   * to it; empty when it already does.
   */
  public static List<Move> face(At at, Vec3 listener) {
    var wanted = Rotation.looking(at.position().plus(new Vec3(0, EYE_HEIGHT, 0)), listener);
    return wanted.differenceTo(at.facing()) < MIN_TURN ? List.of() : List.of(new Move.Face(wanted));
  }

  /** Advances {@code walker} by one tick. */
  public Tick tick(Walker walker, Observation seen) {
    return switch (walker.phase()) {
      case Phase.Resting(var until) -> rest(walker, until, seen);
      case Phase.Planning planning -> plan(walker, planning, seen);
      case Phase.Following following -> follow(walker, following, seen);
    };
  }

  private Tick rest(Walker walker, long until, Observation seen) {
    if (seen.tick() >= until) {
      var stop =
          walker.intent() instanceof Intent.Patrol(var route)
              ? (walker.stop() + 1) % route.size()
              : 0;
      return depart(walker.intent(), stop, new At(seen.position(), seen.facing()), seen.tick());
    }
    if (walker.intent() instanceof Intent.Sleep) {
      return new Tick(walker, List.of());
    }
    var wanted =
        seen.watcher()
            .map(eyes -> Rotation.looking(seen.position().plus(new Vec3(0, EYE_HEIGHT, 0)), eyes))
            .orElseGet(() -> restFacing(walker.intent(), seen.facing()));
    if (wanted.differenceTo(seen.facing()) < MIN_TURN) {
      return new Tick(walker, List.of());
    }
    return new Tick(walker, List.of(new Move.Face(wanted)));
  }

  private Tick plan(Walker walker, Phase.Planning planning, Observation seen) {
    var path = seen.path().filter(found -> !found.waypoints().isEmpty());
    if (path.isPresent()) {
      var waypoints = path.get().waypoints();
      var following =
          new Phase.Following(
              planning.target(),
              waypoints,
              0,
              seen.position().distance(waypoints.getFirst()),
              seen.tick(),
              planning.replans());
      return follow(new Walker(walker.intent(), walker.stop(), following), following, seen)
          .after(List.of(new Move.ReleaseNavigator()));
    }
    if (planning.attempts() + 1 >= settings.pathAttempts()) {
      return giveUp(walker, planning.target(), seen).after(List.of(new Move.ReleaseNavigator()));
    }
    var waiting =
        new Phase.Planning(planning.target(), planning.attempts() + 1, planning.replans());
    return new Tick(new Walker(walker.intent(), walker.stop(), waiting), List.of());
  }

  private Tick follow(Walker walker, Phase.Following following, Observation seen) {
    var waypoint = following.waypoints().get(following.next());
    var distance = seen.position().distance(waypoint);
    var facing = Rotation.heading(seen.position(), waypoint, seen.facing());
    if (distance <= settings.speed()) {
      return reachWaypoint(walker, following, seen, new Move.Step(waypoint, facing));
    }
    var progressed = distance < following.best() - PROGRESS_EPSILON;
    if (!progressed && seen.tick() - following.progressAt() >= settings.stuckTicks()) {
      return giveUp(walker, following.target(), seen);
    }
    var next =
        new Phase.Following(
            following.target(),
            following.waypoints(),
            following.next(),
            progressed ? distance : following.best(),
            progressed ? seen.tick() : following.progressAt(),
            following.replans());
    var step = new Move.Step(seen.position().towards(waypoint, settings.speed()), facing);
    return new Tick(new Walker(walker.intent(), walker.stop(), next), List.of(step));
  }

  private Tick reachWaypoint(
      Walker walker, Phase.Following following, Observation seen, Move.Step step) {
    var reached = following.next() + 1;
    if (reached < following.waypoints().size()) {
      var next =
          new Phase.Following(
              following.target(),
              following.waypoints(),
              reached,
              step.to().distance(following.waypoints().get(reached)),
              seen.tick(),
              following.replans());
      return new Tick(new Walker(walker.intent(), walker.stop(), next), List.of(step));
    }
    if (step.to().distance(following.target()) <= settings.arriveDistance()) {
      return arrive(walker.intent(), walker.stop(), step.facing(), seen.tick())
          .after(List.of(step));
    }
    if (following.replans() >= settings.maxReplans()) {
      return giveUp(walker, following.target(), seen).after(List.of(step));
    }
    var replanning = new Phase.Planning(following.target(), 0, following.replans() + 1);
    return new Tick(new Walker(walker.intent(), walker.stop(), replanning), List.of(step));
  }

  /**
   * Stops walking. Content places are known to be standable, so the NPC teleports there; a random
   * wander point may be inside a wall, so a wandering NPC instead rests where it is and picks
   * another point later.
   */
  private Tick giveUp(Walker walker, Vec3 target, Observation seen) {
    if (walker.intent() instanceof Intent.Wander) {
      return arrive(walker.intent(), walker.stop(), seen.facing(), seen.tick());
    }
    var facing = Rotation.heading(seen.position(), target, seen.facing());
    return arrive(walker.intent(), walker.stop(), facing, seen.tick())
        .after(List.of(new Move.Teleport(target, facing)));
  }

  private Tick depart(Intent intent, int stop, At at, long now) {
    var target = destination(intent, stop);
    if (at.position().distance(target) <= settings.arriveDistance()) {
      return arrive(intent, stop, at.facing(), now);
    }
    return new Tick(
        new Walker(intent, stop, new Phase.Planning(target, 0, 0)),
        List.of(new Move.Settle(at.facing(), NpcPose.STANDING)));
  }

  private Tick arrive(Intent intent, int stop, Rotation facing, long now) {
    var until =
        switch (intent) {
          case Intent.Stand _, Intent.Sleep _ -> Long.MAX_VALUE;
          case Intent.Wander _, Intent.Patrol _ -> now + dwell();
        };
    return new Tick(
        new Walker(intent, stop, new Phase.Resting(until)),
        List.of(new Move.Settle(restFacing(intent, facing), NpcBrain.restingPose(intent))));
  }

  private long dwell() {
    return settings.dwellMinTicks()
        + (long) random.nextInt(settings.dwellMaxTicks() - settings.dwellMinTicks() + 1);
  }

  private Vec3 destination(Intent intent, int stop) {
    return switch (intent) {
      case Intent.Stand(var spot, var _) -> spot.position();
      case Intent.Sleep(var bed) -> bed.position();
      case Intent.Patrol(var route) -> route.get(stop).position();
      case Intent.Wander(var center, var radius) -> {
        // Uniform over the disc: the square root keeps points from bunching at the center.
        var angle = random.nextDouble() * 2 * Math.PI;
        var distance = Math.sqrt(random.nextDouble()) * radius;
        yield center
            .position()
            .plus(new Vec3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance));
      }
    };
  }

  private static Rotation restFacing(Intent intent, Rotation current) {
    return switch (intent) {
      case Intent.Stand(var spot, var _) -> spot.rotation();
      case Intent.Sleep(var bed) -> bed.rotation();
      case Intent.Wander _, Intent.Patrol _ -> current;
    };
  }
}
