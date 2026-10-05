package com.shepherdjerred.thestorm.rwfbots.domain.lobby;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavPath;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.random.RandomGenerator;

/**
 * How a bot passes the time in the lobby: a small utility planner, apart from match tactics, run a
 * couple of times a second. While an activity lasts the bot keeps it; when it ends, the next is
 * drawn by the bot's {@link LobbyTemperament}, the last one weighing half so bots vary what they
 * do. Walks follow the lobby's baked nav graph, so bots step around the alcoves and climb to the
 * balcony. Pure: the same input and random source always give the same plan.
 */
public final class LobbyLife {

  /** Server ticks per second. */
  static final int TICKS_PER_SECOND = 20;

  /** About how many ticks a walking bot takes per waypoint, for timing an activity. */
  static final int TICKS_PER_STEP = 6;

  /** The longest a walk may run before the bot gives up and chooses again. */
  static final int MAX_WALK_TICKS = 12 * TICKS_PER_SECOND;

  /** How close someone must be for a sneak tap to be aimed at them. */
  static final double GREETING_RANGE = 6;

  /** How far from its side's mark a bot hanging out may stand. */
  static final double HANG_OUT_SPREAD = 2.5;

  /**
   * How often a bot's first move on walking in is to go and say hello to a human with a few sneak
   * taps, the Minecraft wave.
   */
  static final double HELLO_CHANCE = 0.5;

  private LobbyLife() {}

  /**
   * Who the bot is.
   *
   * @param uuid its entity
   * @param personality its personality id
   * @param temperament how it passes the time
   * @param rivals the personality ids it has history with
   * @param nextKit the kit it will switch to next, if it has a switch left
   */
  public record Self(
      UUID uuid,
      String personality,
      LobbyTemperament temperament,
      List<String> rivals,
      Optional<String> nextKit) {

    public Self {
      rivals = List.copyOf(rivals);
    }
  }

  /**
   * What one planning step reads.
   *
   * @param self the bot
   * @param scene the lobby now
   * @param nav the lobby's baked navigation
   * @param current what the bot is doing, if anything
   */
  public record Input(Self self, LobbyScene scene, NavArtifact nav, Optional<LobbyPlan> current) {}

  /** What the bot does next: its current activity while it lasts, else a fresh one. */
  public static LobbyPlan next(Input input, RandomGenerator random) {
    var current = input.current();
    if (current.isPresent() && input.scene().tick() < current.orElseThrow().untilTick()) {
      return current.orElseThrow();
    }
    if (current.isEmpty() && random.nextDouble() < HELLO_CHANCE) {
      var hello = hello(new Step(input, random));
      if (hello.isPresent()) {
        return hello.orElseThrow();
      }
    }
    var activity = draw(input.self().temperament(), current.map(LobbyPlan::activity), random);
    return plan(activity, new Step(input, random));
  }

  /** Draws an activity by weight, halving the one just done. */
  static Activity draw(
      LobbyTemperament temperament, Optional<Activity> previous, RandomGenerator random) {
    var total = 0.0;
    var weights = new EnumMap<Activity, Double>(Activity.class);
    for (var activity : Activity.values()) {
      var weight = temperament.weight(activity);
      if (previous.filter(activity::equals).isPresent()) {
        weight /= 2;
      }
      weights.put(activity, weight);
      total += weight;
    }
    var roll = random.nextDouble() * total;
    var chosen = Activity.HANG_OUT;
    for (var entry : weights.entrySet()) {
      roll -= entry.getValue();
      chosen = entry.getKey();
      if (roll < 0) {
        break;
      }
    }
    return chosen;
  }

  /** One planning step's inputs and randomness. */
  private record Step(Input input, RandomGenerator random) {

    long now() {
      return input.scene().tick();
    }

    Vec3 feet() {
      return input
          .scene()
          .person(input.self().uuid())
          .map(LobbyScene.Person::feet)
          .orElseThrow(() -> new IllegalStateException("a planning bot stands in the lobby"));
    }

    int between(int low, int high) {
      return random.nextInt(low, high + 1);
    }
  }

  private static LobbyPlan plan(Activity activity, Step step) {
    return switch (activity) {
      case WANDER -> wander(step);
      case APPROACH -> approach(step).orElseGet(() -> wander(step));
      case BROWSE_KITS -> browse(step).orElseGet(() -> wander(step));
      case LOOK_AROUND -> lookAround(step);
      case SNEAK_TAP -> sneakTap(step);
      case JUMP -> jump(step);
      case HANG_OUT -> hangOut(step).orElseGet(() -> wander(step));
    };
  }

  private static LobbyPlan wander(Step step) {
    var graph = step.input().nav().graph();
    var target = graph.feet(step.random().nextInt(graph.nodeCount()));
    var path = path(step, target);
    return new LobbyPlan(
        Activity.WANDER,
        path,
        List.of(),
        Optional.empty(),
        false,
        false,
        step.now() + walkTicks(path) + step.between(10, 40));
  }

  private static Optional<LobbyPlan> approach(Step step) {
    var self = step.input().self();
    var feet = step.feet();
    var others = new ArrayList<LobbyScene.Person>();
    var weights = new ArrayList<Double>();
    for (var person : step.input().scene().people()) {
      if (person.uuid().equals(self.uuid())) {
        continue;
      }
      var rival = person.personality().filter(self.rivals()::contains).isPresent();
      others.add(person);
      weights.add(rival ? 3.0 : person.human() ? 2.0 : 1.0);
    }
    if (others.isEmpty()) {
      return Optional.empty();
    }
    var target = others.get(weighted(weights, step.random()));
    var away = feet.minus(target.feet()).horizontal();
    var direction = away.isZero() ? new Vec3(1, 0, 0) : away.normalized();
    var stop = target.feet().plus(direction.scale(self.temperament().closeness()));
    var path = path(step, stop);
    return Optional.of(
        new LobbyPlan(
            Activity.APPROACH,
            path,
            List.of(),
            Optional.of(target.uuid()),
            false,
            false,
            step.now() + walkTicks(path) + step.between(60, 120)));
  }

  /** Walks up to a human in the lobby and taps sneak at them; empty when no human is there. */
  private static Optional<LobbyPlan> hello(Step step) {
    var humans = step.input().scene().people().stream().filter(LobbyScene.Person::human).toList();
    if (humans.isEmpty()) {
      return Optional.empty();
    }
    var human = humans.get(step.random().nextInt(humans.size()));
    var feet = step.feet();
    var away = feet.minus(human.feet()).horizontal();
    var direction = away.isZero() ? new Vec3(1, 0, 0) : away.normalized();
    var path = path(step, human.feet().plus(direction.scale(2)));
    return Optional.of(
        new LobbyPlan(
            Activity.SNEAK_TAP,
            path,
            List.of(),
            Optional.of(human.uuid()),
            true,
            false,
            step.now() + walkTicks(path) + step.between(40, 70)));
  }

  private static Optional<LobbyPlan> browse(Step step) {
    var sites = step.input().nav().sites();
    var alcoves =
        sites.spawns().stream().filter(site -> site.name().startsWith("alcove-")).toList();
    if (alcoves.isEmpty()) {
      return Optional.empty();
    }
    var wanted =
        step.input()
            .self()
            .nextKit()
            .flatMap(kit -> sites.spawn(LobbyNav.alcove(kit)))
            .orElseGet(() -> alcoves.get(step.random().nextInt(alcoves.size())));
    var stand = wanted.cell().feet();
    var path = path(step, stand);
    var middle = sites.spawn(LobbyNav.SPAWN).map(site -> site.cell().feet()).orElse(stand);
    var outward = stand.minus(middle).horizontal();
    var item =
        stand.plus(outward.isZero() ? Vec3.ZERO : outward.normalized().scale(3)).plus(0, 1.2, 0);
    var until = step.now() + walkTicks(path) + step.between(60, 120);
    return Optional.of(
        new LobbyPlan(
            Activity.BROWSE_KITS,
            path,
            List.of(new LobbyPlan.Glance(item, until)),
            Optional.empty(),
            false,
            false,
            until));
  }

  private static LobbyPlan lookAround(Step step) {
    var glances = new ArrayList<LobbyPlan.Glance>();
    var at = step.now();
    var people = step.input().scene().people();
    var graph = step.input().nav().graph();
    var count = step.between(2, 4);
    for (var i = 0; i < count; i++) {
      at += step.between(20, 50);
      var someone = people.get(step.random().nextInt(people.size()));
      var point =
          someone.uuid().equals(step.input().self().uuid())
              ? graph.feet(step.random().nextInt(graph.nodeCount()))
              : someone.feet();
      glances.add(new LobbyPlan.Glance(point.plus(0, CombatantView.EYE_HEIGHT, 0), at));
    }
    return new LobbyPlan(
        Activity.LOOK_AROUND, List.of(), glances, Optional.empty(), false, false, at);
  }

  private static LobbyPlan sneakTap(Step step) {
    var self = step.input().self().uuid();
    var feet = step.feet();
    var nearest =
        step.input().scene().people().stream()
            .filter(person -> !person.uuid().equals(self))
            .filter(person -> person.feet().distance(feet) <= GREETING_RANGE)
            .min(Comparator.comparingDouble(person -> person.feet().distance(feet)));
    return new LobbyPlan(
        Activity.SNEAK_TAP,
        List.of(),
        List.of(),
        nearest.map(LobbyScene.Person::uuid),
        true,
        false,
        step.now() + step.between(30, 60));
  }

  private static LobbyPlan jump(Step step) {
    return new LobbyPlan(
        Activity.JUMP,
        List.of(),
        List.of(),
        Optional.empty(),
        false,
        true,
        step.now() + step.between(20, 50));
  }

  private static Optional<LobbyPlan> hangOut(Step step) {
    var sites = step.input().nav().sites();
    var sides = sites.spawns().stream().filter(site -> site.name().startsWith("side-")).toList();
    if (sides.isEmpty()) {
      return Optional.empty();
    }
    // A bot favours one side, so friends who share it end up standing together.
    var self = step.input().self();
    var side = sides.get(Math.floorMod(self.personality().hashCode(), sides.size()));
    var spot =
        side.cell()
            .feet()
            .plus(
                (step.random().nextDouble() * 2 - 1) * HANG_OUT_SPREAD,
                0,
                (step.random().nextDouble() * 2 - 1) * HANG_OUT_SPREAD);
    var path = path(step, spot);
    var middle = sites.spawn(LobbyNav.SPAWN).map(site -> site.cell().feet()).orElse(spot);
    var until = step.now() + walkTicks(path) + step.between(80, 160);
    return Optional.of(
        new LobbyPlan(
            Activity.HANG_OUT,
            path,
            List.of(new LobbyPlan.Glance(middle.plus(0, CombatantView.EYE_HEIGHT, 0), until)),
            Optional.empty(),
            false,
            false,
            until));
  }

  /** The walk from the bot's feet to the node nearest {@code to}; empty when it is there. */
  private static List<Waypoint> path(Step step, Vec3 to) {
    var graph = step.input().nav().graph();
    var from = graph.nearestNode(step.feet());
    var target = graph.nearestNode(to);
    if (from.isEmpty() || target.isEmpty()) {
      return List.of();
    }
    return graph
        .path(from.getAsInt(), target.getAsInt())
        .map(NavPath::toFollow)
        .orElseGet(List::of);
  }

  private static long walkTicks(List<Waypoint> path) {
    return Math.min(MAX_WALK_TICKS, (long) path.size() * TICKS_PER_STEP);
  }

  private static int weighted(List<Double> weights, RandomGenerator random) {
    var total = weights.stream().mapToDouble(Double::doubleValue).sum();
    var roll = random.nextDouble() * total;
    for (var i = 0; i < weights.size(); i++) {
      roll -= weights.get(i);
      if (roll < 0) {
        return i;
      }
    }
    return weights.size() - 1;
  }
}
