package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Turns a team's strategy into positions, one per living bot, so a team spreads over the map like a
 * side in a field game instead of walking one path to one bomb. Each strategy is an ordered list of
 * wants; a team of {@code n} takes the first {@code n}, so slot keys stay put as bots die.
 *
 * <ul>
 *   <li>RUSH: the planter on the middle lane, a two-escort wedge, then the side lanes and flanks.
 *   <li>SPLIT: the planter and one escort on one lane, a pair on the other lane, a flank, then
 *       overwatch and anchors.
 *   <li>TURTLE: anchors spread over distinct approaches to the own bomb, overwatch, and a planter
 *       that goes round the far lane.
 *   <li>HUNT: sweeping pairs towards where the enemy was seen, a planter and overwatch.
 * </ul>
 *
 * <p>The nuke is just another objective: a strategy names which bomb it plays for, it never wins by
 * being closest. Static slots keep at least {@link #SPACING} blocks apart; escorts are a wedge
 * relative to the planter and are placed where the planter is when dealt.
 */
public final class Playbook {

  /** The least distance between two static slots. */
  public static final double SPACING = 4;

  /** How far behind the planter its escorts walk. */
  public static final double ESCORT_BEHIND = 3;

  /** How far to either side of the planter its escorts walk. */
  public static final double ESCORT_SIDE = 3;

  /** How far ahead of the planter, as lane progress, lane slots screen. */
  static final double AHEAD = 0.2;

  /** Lane slots stand at least this far along their lane, clear of the team's own doorways. */
  static final double LANE_NEAREST = 0.3;

  /** How far ahead of the planter, as lane progress, flanks wait. */
  static final double FLANK_AHEAD = 0.35;

  /** How much wider than the outer lane a flank stands, in blocks. */
  static final double FLANK_WIDEN = 5;

  static final double OVERWATCH_MIN = 14;
  static final double OVERWATCH_MAX = 28;
  static final double OVERWATCH_IDEAL = 20;

  /** Overwatch stays on the team's side: at most this far along the way to the objective. */
  static final double OVERWATCH_FURTHEST = 0.55;

  /** Anchors never stand in a lane this close to home: that is the team's way out. */
  static final double WAY_OUT = 14;

  /** Anchors stand at most this far from the bomb they hold. */
  static final double ANCHOR_MAX = 14;

  /** How far along its lane a pair with no sighting to chase sweeps. */
  static final double SWEEP_PROGRESS = 0.6;

  /** How far apart pairs sweeping towards the enemy's home fan out. */
  static final double SWEEP_FAN = 10;

  /** How far beside its partner the second sweeper walks. */
  static final double SWEEP_PARTNER = 4.5;

  private static final int SNAP = 3;
  private static final int SEARCH_RINGS = 8;
  private static final double PROGRESS_STEP = 0.1;

  private Playbook() {}

  /**
   * What a deal is made from.
   *
   * @param nav the baked map
   * @param strategy the team's strategy
   * @param size how many slots to deal
   * @param home where the team starts
   * @param objective the bomb the team plays for, if any is left
   * @param lanes the lanes from home to the objective
   * @param planter where the planter stands now (home before the first deal)
   * @param guard the bomb anchors hold: the own bomb, else home
   * @param guardClear how close to {@code guard} anchors may stand (poison pushes them out)
   * @param sightings where teammates last saw enemies, newest first
   * @param enemyHome where the enemy starts
   * @param watchers nav regions the enemy can see from, for picking hidden flank points
   */
  public record Setup(
      NavArtifact nav,
      Strategy strategy,
      int size,
      Vec3 home,
      Optional<BombView> objective,
      List<Lane> lanes,
      Vec3 planter,
      Vec3 guard,
      double guardClear,
      List<Vec3> sightings,
      Vec3 enemyHome,
      Set<Integer> watchers) {

    public Setup {
      lanes = List.copyOf(lanes);
      sightings = List.copyOf(sightings);
      watchers = Set.copyOf(watchers);
      if (size < 1) {
        throw new IllegalArgumentException("a deal is for at least one bot");
      }
      if (objective.isPresent() && lanes.isEmpty()) {
        throw new IllegalArgumentException("an objective needs at least one lane to it");
      }
    }
  }

  /** One entry of a strategy's list. */
  record Want(SlotKind kind, Lanes.Which which, int pair, Role role, double side) {

    static Want of(SlotKind kind, Lanes.Which which) {
      return new Want(kind, which, -1, kind.role(), 0);
    }

    static Want paired(SlotKind kind, Lanes.Which which, int pair) {
      return new Want(kind, which, pair, kind.role(), 0);
    }

    static Want escort(double side) {
      return new Want(SlotKind.ESCORT, Lanes.Which.MIDDLE, -1, Role.ESCORT, side);
    }
  }

  /** The first {@code size} wants of {@code strategy}; without an objective, hold and hunt. */
  static List<Want> wants(Strategy strategy, int size, boolean objective) {
    var out = new ArrayList<Want>(size);
    for (var i = 0; out.size() < size; i++) {
      out.add(objective ? want(strategy, i) : guard(i));
    }
    return out;
  }

  private static Want guard(int i) {
    var cycle = i % 3;
    return cycle == 0
        ? Want.of(SlotKind.ANCHOR, Lanes.Which.MIDDLE)
        : Want.paired(SlotKind.SWEEP, Lanes.Which.MIDDLE, i / 3);
  }

  private static Want want(Strategy strategy, int i) {
    return switch (strategy) {
      case RUSH -> rush(i);
      case SPLIT -> split(i);
      case TURTLE -> turtle(i);
      case HUNT -> hunt(i);
    };
  }

  private static Want rush(int i) {
    return switch (i) {
      case 0 -> Want.of(SlotKind.PLANT, Lanes.Which.MIDDLE);
      case 1 -> Want.escort(ESCORT_SIDE);
      case 2 -> Want.escort(-ESCORT_SIDE);
      case 3 -> Want.paired(SlotKind.LANE, Lanes.Which.LEFT, 1);
      case 4 -> Want.paired(SlotKind.LANE, Lanes.Which.RIGHT, 2);
      case 5 -> Want.paired(SlotKind.FLANK, Lanes.Which.LEFT, 1);
      case 6 -> Want.paired(SlotKind.FLANK, Lanes.Which.RIGHT, 2);
      case 7 -> Want.of(SlotKind.OVERWATCH, Lanes.Which.MIDDLE);
      default -> Want.of(SlotKind.LANE, cycle(i));
    };
  }

  private static Want split(int i) {
    return switch (i) {
      case 0 -> Want.of(SlotKind.PLANT, Lanes.Which.LEFT);
      case 1 -> Want.escort(ESCORT_SIDE);
      case 2, 3 -> Want.paired(SlotKind.LANE, Lanes.Which.RIGHT, 1);
      case 4 -> Want.of(SlotKind.FLANK, Lanes.Which.RIGHT);
      case 5 -> Want.of(SlotKind.OVERWATCH, Lanes.Which.MIDDLE);
      case 6 -> Want.of(SlotKind.ANCHOR, Lanes.Which.MIDDLE);
      default ->
          i % 2 == 0
              ? Want.of(SlotKind.ANCHOR, Lanes.Which.MIDDLE)
              : Want.of(SlotKind.LANE, Lanes.Which.LEFT);
    };
  }

  private static Want turtle(int i) {
    return switch (i) {
      case 0 -> new Want(SlotKind.ANCHOR, Lanes.Which.MIDDLE, -1, Role.RETAKE, 0);
      case 1 -> Want.of(SlotKind.PLANT, Lanes.Which.RIGHT);
      case 2 -> Want.of(SlotKind.ANCHOR, Lanes.Which.MIDDLE);
      case 3 -> Want.of(SlotKind.OVERWATCH, Lanes.Which.MIDDLE);
      default -> Want.of(SlotKind.ANCHOR, Lanes.Which.MIDDLE);
    };
  }

  private static Want hunt(int i) {
    return switch (i) {
      case 0, 1 -> Want.paired(SlotKind.SWEEP, Lanes.Which.LEFT, 0);
      case 2 -> Want.of(SlotKind.PLANT, Lanes.Which.MIDDLE);
      case 3, 4 -> Want.paired(SlotKind.SWEEP, Lanes.Which.RIGHT, 1);
      case 5 -> Want.of(SlotKind.OVERWATCH, Lanes.Which.MIDDLE);
      default -> Want.paired(SlotKind.SWEEP, cycle(i), i / 2);
    };
  }

  /** Left, middle and right in turn. */
  private static Lanes.Which cycle(int i) {
    return switch (i % 3) {
      case 0 -> Lanes.Which.LEFT;
      case 1 -> Lanes.Which.MIDDLE;
      default -> Lanes.Which.RIGHT;
    };
  }

  /** Deals {@code setup.size()} slots. */
  public static List<Slot> deal(Setup setup) {
    var deal = new Deal(setup);
    var slots = new ArrayList<Slot>(setup.size());
    for (var want : wants(setup.strategy(), setup.size(), setup.objective().isPresent())) {
      slots.add(deal.slot(want));
    }
    return slots;
  }

  /** One deal in progress: what is placed so far and how many of each kind. */
  private static final class Deal {
    private final Setup setup;
    private final NavGraph graph;
    private final List<Vec3> placed = new ArrayList<>();
    private final List<Vec3> anchorDirections = new ArrayList<>();
    private final java.util.EnumMap<SlotKind, Integer> counts =
        new java.util.EnumMap<>(SlotKind.class);
    private final Vec3 axis;
    private final Vec3 side;
    private final double push;

    Deal(Setup setup) {
      this.setup = setup;
      this.graph = setup.nav().graph();
      var direction = target().minus(setup.home()).horizontal();
      this.axis = direction.isZero() ? new Vec3(1, 0, 0) : direction.normalized();
      this.side = new Vec3(-axis.z(), 0, axis.x());
      this.push = planterProgress();
    }

    /** What the team is heading for: the objective, else the latest sighting, else their home. */
    private Vec3 target() {
      return setup
          .objective()
          .map(BombView::pos)
          .or(() -> setup.sightings().stream().findFirst())
          .orElseGet(setup::enemyHome);
    }

    private double planterProgress() {
      var lane = laneIndex(Lanes.Which.MIDDLE);
      if (lane < 0) {
        return 0;
      }
      var progress = setup.lanes().get(lane).progressOf(setup.planter());
      return Math.floor(progress / PROGRESS_STEP) * PROGRESS_STEP;
    }

    private int laneIndex(Lanes.Which which) {
      return Lanes.pick(setup.lanes(), which);
    }

    Slot slot(Want want) {
      var index = counts.merge(want.kind(), 1, Integer::sum) - 1;
      var key = want.kind().name().toLowerCase(java.util.Locale.ROOT) + "-" + index;
      return switch (want.kind()) {
        case PLANT -> plant(key, want);
        case ESCORT -> escort(key, want);
        case LANE -> lane(key, want, index);
        case FLANK -> flank(key, want);
        case OVERWATCH -> overwatch(key, want);
        case ANCHOR -> anchor(key, want, index);
        case SWEEP -> sweep(key, want, index);
      };
    }

    private Slot plant(String key, Want want) {
      var bomb = setup.objective().orElseThrow();
      var at = place(approach(bomb));
      return new Slot(
          key,
          SlotKind.PLANT,
          want.role(),
          at,
          bomb.pos(),
          laneIndex(want.which()),
          want.pair(),
          Optional.of(bomb.id()),
          0);
    }

    private Vec3 approach(BombView bomb) {
      var node = graph.nearestNodeWithin(bomb.pos().plus(0, -0.5, 0), SNAP);
      return node.isPresent() ? graph.feet(node.getAsInt()) : bomb.pos();
    }

    private Slot escort(String key, Want want) {
      var at = escortPoint(setup.planter(), heading(setup.planter()), want.side());
      placed.add(at);
      return new Slot(
          key,
          SlotKind.ESCORT,
          want.role(),
          at,
          setup.planter().plus(heading(setup.planter()).scale(12)),
          laneIndex(Lanes.Which.MIDDLE),
          want.pair(),
          Optional.empty(),
          want.side());
    }

    private Vec3 heading(Vec3 from) {
      var direction = target().minus(from).horizontal();
      return direction.isZero() ? axis : direction.normalized();
    }

    private Slot lane(String key, Want want, int index) {
      var lane = laneIndex(want.which());
      var rank = index / 3;
      var progress = Math.clamp(push + AHEAD - 0.12 * rank, LANE_NEAREST, 0.8);
      var chosen = setup.lanes().get(lane);
      var at = place(chosen.at(progress));
      return new Slot(
          key,
          SlotKind.LANE,
          want.role(),
          at,
          chosen.at(progress + 0.25),
          lane,
          want.pair(),
          Optional.empty(),
          0);
    }

    private Slot flank(String key, Want want) {
      var lane = laneIndex(want.which());
      var chosen = setup.lanes().get(lane);
      var progress = Math.clamp(push + FLANK_AHEAD, 0.35, 0.85);
      var outward = want.which() == Lanes.Which.LEFT ? side.scale(-1) : side;
      var base = chosen.at(progress).plus(outward.scale(FLANK_WIDEN));
      var at = place(hidden(base));
      return new Slot(
          key,
          SlotKind.FLANK,
          want.role(),
          at,
          setup.objective().map(BombView::pos).orElseGet(() -> chosen.at(1)),
          lane,
          want.pair(),
          Optional.empty(),
          0);
    }

    /** The node near {@code base} the fewest enemy regions can see. */
    private Vec3 hidden(Vec3 base) {
      var regions = setup.nav().regions();
      var best = snap(base);
      var bestScore = Double.POSITIVE_INFINITY;
      for (var dx = -3; dx <= 3; dx += 3) {
        for (var dz = -3; dz <= 3; dz += 3) {
          var node = graph.nearestNodeWithin(base.plus(dx, 0, dz), 1);
          if (node.isEmpty()) {
            continue;
          }
          var exposure =
              regions.exposure(regions.regionOf(node.getAsInt()), setup.watchers())
                  + 0.01 * graph.feet(node.getAsInt()).horizontalDistance(base);
          if (exposure < bestScore) {
            bestScore = exposure;
            best = graph.feet(node.getAsInt());
          }
        }
      }
      return best;
    }

    private Slot overwatch(String key, Want want) {
      var objective = target();
      var regions = setup.nav().regions();
      var target = graph.nearestNodeWithin(objective.plus(0, -0.5, 0), SNAP);
      var length = objective.minus(setup.home()).horizontal().length();
      Optional<Vec3> best = Optional.empty();
      var bestScore = Double.NEGATIVE_INFINITY;
      for (var point : setup.nav().cover().points()) {
        var feet = graph.feet(point.node());
        var distance = feet.horizontalDistance(objective);
        var along = feet.minus(setup.home()).horizontal().dot(axis) / Math.max(1, length);
        var sees =
            target.isEmpty()
                || regions.canSee(
                    regions.regionOf(point.node()), regions.regionOf(target.getAsInt()));
        if (distance < OVERWATCH_MIN
            || distance > OVERWATCH_MAX
            || along > OVERWATCH_FURTHEST
            || !sees) {
          continue;
        }
        var room = Math.min(10, nearestPlaced(feet));
        if (room < SPACING) {
          continue;
        }
        var score = room - Math.abs(distance - OVERWATCH_IDEAL) * 0.5;
        if (score > bestScore) {
          bestScore = score;
          best = Optional.of(feet);
        }
      }
      var middle = laneIndex(Lanes.Which.MIDDLE);
      var at =
          best.map(this::keep)
              .orElseGet(
                  () -> place(middle < 0 ? setup.home() : setup.lanes().get(middle).at(0.45)));
      return new Slot(
          key,
          SlotKind.OVERWATCH,
          want.role(),
          at,
          objective,
          middle,
          want.pair(),
          Optional.empty(),
          0);
    }

    private Slot anchor(String key, Want want, int index) {
      var guard = setup.guard();
      var threat = setup.sightings().stream().findFirst().orElseGet(setup::enemyHome);
      var toEnemy = threat.minus(guard).horizontal();
      var facing = toEnemy.isZero() ? axis : toEnemy.normalized();
      Optional<Vec3> best = Optional.empty();
      var bestScore = Double.NEGATIVE_INFINITY;
      for (var point : setup.nav().cover().points()) {
        var feet = graph.feet(point.node());
        var offset = feet.minus(guard).horizontal();
        var distance = offset.length();
        if (distance < setup.guardClear()
            || distance > ANCHOR_MAX
            || nearestPlaced(feet) < SPACING
            || onWayOut(point.node(), feet)) {
          continue;
        }
        var direction = offset.normalized();
        var score = spread(direction) + 0.2 * direction.dot(facing) - 0.02 * distance;
        if (score > bestScore) {
          bestScore = score;
          best = Optional.of(feet);
        }
      }
      var at = best.map(this::keep).orElseGet(() -> place(ring(guard, facing, index)));
      var direction = at.minus(guard).horizontal();
      var out = direction.isZero() ? facing : direction.normalized();
      anchorDirections.add(out);
      return new Slot(
          key,
          SlotKind.ANCHOR,
          want.role(),
          at,
          at.plus(out.scale(16)),
          -1,
          want.pair(),
          Optional.empty(),
          0);
    }

    /**
     * Whether {@code node} lies on the team's way out of its spawn: in a lane's corridor near home,
     * where an anchor would stand in everyone's path (a base doorway).
     */
    private boolean onWayOut(int node, Vec3 feet) {
      return feet.horizontalDistance(setup.home()) < WAY_OUT
          && setup.lanes().stream().anyMatch(lane -> lane.corridor().contains(node));
    }

    /** The smallest angle between {@code direction} and the anchors already dealt, in radians. */
    private double spread(Vec3 direction) {
      var least = Math.PI;
      for (var other : anchorDirections) {
        least = Math.min(least, direction.angleTo(other));
      }
      return least;
    }

    private Vec3 ring(Vec3 guard, Vec3 facing, int index) {
      var radius = Math.max(setup.guardClear() + 1, 6);
      var angle =
          Math.atan2(facing.z(), facing.x()) + (index % 2 == 0 ? 1 : -1) * (index + 1) * 0.6;
      return guard.plus(new Vec3(Math.cos(angle), 0, Math.sin(angle)).scale(radius));
    }

    private Slot sweep(String key, Want want, int index) {
      var sightings = setup.sightings();
      var lane = laneIndex(want.which());
      // Each pair takes its own sighting; pairs beyond the sightings sweep their lane.
      var pair = Math.max(0, want.pair());
      var target =
          pair < sightings.size()
              ? sightings.get(pair)
              : lane >= 0
                  ? setup.lanes().get(lane).at(SWEEP_PROGRESS)
                  : setup.enemyHome().plus(side.scale((pair % 3 - 1) * SWEEP_FAN));
      var regions = setup.nav().regions();
      var node = graph.nearestNodeWithin(target, SNAP);
      var centre = node.isPresent() ? regions.centroid(regions.regionOf(node.getAsInt())) : target;
      var desired = index % 2 == 0 ? centre : centre.plus(side.scale(SWEEP_PARTNER));
      var at = place(desired);
      return new Slot(
          key,
          SlotKind.SWEEP,
          want.role(),
          at,
          at.plus(heading(at).scale(10)),
          lane,
          want.pair(),
          Optional.empty(),
          0);
    }

    private double nearestPlaced(Vec3 point) {
      var least = Double.POSITIVE_INFINITY;
      for (var other : placed) {
        least = Math.min(least, other.horizontalDistance(point));
      }
      return least;
    }

    private Vec3 keep(Vec3 point) {
      placed.add(point);
      return point;
    }

    private Vec3 snap(Vec3 point) {
      var node = graph.nearestNodeWithin(point, SNAP * 2);
      return node.isPresent() ? graph.feet(node.getAsInt()) : point;
    }

    /** The walkable point nearest {@code desired} at least {@link #SPACING} from every slot. */
    private Vec3 place(Vec3 desired) {
      var base = snap(desired);
      if (nearestPlaced(base) >= SPACING) {
        return keep(base);
      }
      var tried = new HashSet<Integer>();
      for (var ring = 1; ring <= SEARCH_RINGS; ring++) {
        var steps = 8 * ring;
        for (var k = 0; k < steps; k++) {
          var angle = 2 * Math.PI * k / steps;
          var probe = desired.plus(Math.cos(angle) * ring, 0, Math.sin(angle) * ring);
          var node = graph.nearestNodeWithin(probe, 1);
          if (node.isEmpty() || !tried.add(node.getAsInt())) {
            continue;
          }
          var feet = graph.feet(node.getAsInt());
          if (nearestPlaced(feet) >= SPACING) {
            return keep(feet);
          }
        }
      }
      return keep(base);
    }
  }

  /** The wedge point {@code side} blocks beside and a few behind {@code planter}. */
  public static Vec3 escortPoint(Vec3 planter, Vec3 heading, double side) {
    var perpendicular = new Vec3(-heading.z(), 0, heading.x());
    return planter.minus(heading.scale(ESCORT_BEHIND)).plus(perpendicular.scale(side));
  }
}
