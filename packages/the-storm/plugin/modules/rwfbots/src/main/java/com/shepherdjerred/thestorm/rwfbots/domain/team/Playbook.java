package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
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
 *   <li>SPLIT: the planter and one escort on one lane, a pair and a flank on the other, a flank on
 *       the first, overwatch and one anchor.
 *   <li>TURTLE: three anchors over distinct approaches to the own bomb, a planter round the far
 *       lane, overwatch, and a lane pair and a flank screening the field.
 *   <li>HUNT: sweeping pairs towards where the enemy was seen, a planter and overwatch.
 * </ul>
 *
 * <p>Every {@link #PLANTER_EVERY}th place past the first of a large team is another planter on a
 * side lane, so a big team carries more than one fuse up the field. A team closing out the round
 * ({@link Setup#closing()}) drops its strategy for a plant rush with escorts and sweeping pairs
 * hunting the last enemies where they were seen.
 *
 * <p>The team moves up the field: lane and flank slots stand at the team's push, a progress along
 * the lanes that grows every deal until the team makes contact ({@link #ADVANCE} a deal from {@link
 * #START_PUSH}), so the side lanes advance with the planter instead of waiting at home.
 *
 * <p>About one bot in four anchors the own bomb, more on a field longer than a retake can walk
 * ({@link #defenders}). The anchors screen the bomb's approaches; where none of that screen would
 * stand within {@link #HOME_RANGE} of it (cover above, below or far from it), the first stays home
 * within {@link #HOME_HOLD} of the bomb, so a lit fuse always has a teammate beside it. Every
 * anchor stands where it can walk to the bomb and back.
 *
 * <p>The nuke is just another objective: a strategy names which bomb it plays for, it never wins by
 * being closest. A nuke the team holds, one it defused or armed, keeps a guard beside it ({@link
 * #HOLD}). Static slots keep at least {@link #SPACING} blocks apart; escorts are a wedge relative
 * to the planter and are placed where the planter is when dealt.
 */
public final class Playbook {

  /** The least distance between two static slots. */
  public static final double SPACING = 4;

  /** How far behind the planter its escorts walk. */
  public static final double ESCORT_BEHIND = 2;

  /** How far to either side of the planter its escorts walk. */
  public static final double ESCORT_SIDE = 3.5;

  /** The push, as lane progress, at the first deal of a match. */
  public static final double START_PUSH = 0.5;

  /** How much the push grows each deal until the team makes contact. */
  public static final double ADVANCE = 0.07;

  /** Once the push reaches this the planter leaves the line and makes for the bomb. */
  public static final double PLANT_GO = 0.6;

  /** The furthest the push goes: the edge of the enemy's ground. */
  public static final double MAX_PUSH = 0.75;

  /** How far ahead of the push lane slots stand; each further rank stands a little behind. */
  static final double AHEAD = 0.05;

  static final double RANK_BEHIND = 0.12;

  /** Lane slots stand at least this far along their lane, clear of the team's own doorways. */
  static final double LANE_NEAREST = 0.3;

  /** How far ahead of the push, as lane progress, flanks wait. */
  static final double FLANK_AHEAD = 0.1;

  /** How much wider than the outer lane a flank stands, in blocks. */
  static final double FLANK_WIDEN = 5;

  static final double OVERWATCH_MIN = 12;
  static final double OVERWATCH_MAX = 28;
  static final double OVERWATCH_IDEAL = 20;

  /** Overwatch stands at least this far from home: out on the field, not in the base. */
  static final double OVERWATCH_OUT = 16;

  /** Overwatch stays on the team's side: at most this far along the way to the enemy's home. */
  static final double OVERWATCH_FURTHEST = 0.55;

  /** Anchors never stand in a lane this close to home: that is the team's way out. */
  static final double WAY_OUT = 14;

  /** Anchors stand at most this far from the bomb they hold. */
  static final double ANCHOR_MAX = 14;

  /** Guard the approaches with room to fan out, instead of hugging the bomb's base. */
  static final double ANCHOR_MIN = 10;

  /**
   * A teammate this close to the own bomb answers a lit fuse at once. In prod (tsmc, Oct 18-23) six
   * teams had one this close less than 40% of the time: their anchors held 13 to 25 blocks out, on
   * cover above or beside the bomb, and a fuse lit there burned while they walked back.
   */
  public static final double HOME_RANGE = 12;

  /**
   * The home anchor's slot stands at most this far from the bomb, so a holder straying about it on
   * patrol (3.5 blocks) stays within {@link #HOME_RANGE}.
   */
  public static final double HOME_HOLD = 8;

  /** The home anchor keeps off the bomb's own block and the fuse workers' places beside it. */
  static final double HOME_NEAREST = 3;

  /**
   * How far a retake may walk, in ticks: a 60 s fuse less a lone ten-second defuse and a ten-second
   * reserve. A field whose route from spawn to the enemy's bomb is longer than this (floating-isles
   * 1232 to 1445, hemispheres 980 to 1043, beanstalk 947 to 984) takes a team further from home
   * than a retake from up the field can make good, so it keeps more of itself home.
   */
  public static final double RETAKE_REACH = 800;

  /** However long the field, at most this much more of a team stands home than on a short one. */
  static final double MAX_STRETCH = 4.0 / 3;

  /** How far along its lane a pair with no sighting to chase sweeps. */
  static final double SWEEP_PROGRESS = 0.6;

  /** How far apart pairs sweeping towards the enemy's home fan out. */
  static final double SWEEP_FAN = 10;

  /** How far beside its partner the second sweeper walks. */
  static final double SWEEP_PARTNER = 4.5;

  /** Every this many places of a team, one more is a planter: about one planter per nine bots. */
  public static final int PLANTER_EVERY = 9;

  /**
   * The key of the slot that guards a nuke the team holds ({@link Setup#held}): an anchor beside it
   * that names it as its bomb. In prod (1020-bf0e) lone bots armed and defused one nuke twelve
   * times in five and a half minutes, because whoever defused it walked off to its strategy's bomb
   * and the other side came back to arm it again.
   */
  public static final String HOLD = "hold-0";

  private static final int SNAP = 3;
  private static final int SEARCH_RINGS = 8;
  // How far past a slot that falls in water placement looks for dry ground.
  private static final int DRY_RINGS = 24;

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
   * @param push how far along the lanes, 0..1, the team has advanced
   * @param guard the bomb anchors hold: the own bomb, else home
   * @param guardClear how close to {@code guard} anchors may stand (poison pushes them out)
   * @param sightings where teammates last saw enemies, newest first
   * @param enemyHome where the enemy starts
   * @param watchers nav regions the enemy can see from, for picking hidden flank points
   * @param closing whether the team is closing out the round: the plant rush and the hunt
   * @param field the walking ticks of the team's shortest baked route from its spawn to an enemy
   *     bomb, or 0 when it has none
   * @param held a nuke the team holds ({@link #HOLD}): one it defused and has not lost since, or
   *     one it armed
   */
  public record Setup(
      NavArtifact nav,
      Strategy strategy,
      int size,
      Vec3 home,
      Optional<BombView> objective,
      List<Lane> lanes,
      Vec3 planter,
      double push,
      Vec3 guard,
      double guardClear,
      List<Vec3> sightings,
      Vec3 enemyHome,
      Set<Integer> watchers,
      boolean closing,
      double field,
      Optional<BombView> held) {

    public Setup {
      lanes = List.copyOf(lanes);
      sightings = List.copyOf(sightings);
      watchers = Set.copyOf(watchers);
      if (size < 1) {
        throw new IllegalArgumentException("a deal is for at least one bot");
      }
      if (!(push >= 0 && push <= 1)) {
        throw new IllegalArgumentException("push must be 0..1: " + push);
      }
      if (objective.isPresent() && lanes.isEmpty()) {
        throw new IllegalArgumentException("an objective needs at least one lane to it");
      }
      if (!(field >= 0) || Double.isInfinite(field)) {
        throw new IllegalArgumentException("field must be a finite walk: " + field);
      }
      if (held.isPresent() && !(held.orElseThrow().owner() instanceof BombOwner.Nuke)) {
        throw new IllegalArgumentException("only a nuke is held: " + held.orElseThrow());
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
    return wants(strategy, size, objective, false);
  }

  /**
   * The first {@code size} wants of {@code strategy}, or of the closing rush while {@code closing};
   * without an objective, hold and hunt.
   */
  static List<Want> wants(Strategy strategy, int size, boolean objective, boolean closing) {
    if (objective) return attacking(strategy, size, closing, 0);
    var out = new ArrayList<Want>(size);
    for (var i = 0; out.size() < size; i++) {
      out.add(guard(i));
    }
    return out;
  }

  /**
   * The first {@code size} wants of {@code strategy} with an objective, or of the closing rush
   * while {@code closing}, with as many anchors as {@link #defenders} keeps home on a field {@code
   * field} ticks long.
   */
  static List<Want> attacking(Strategy strategy, int size, boolean closing, double field) {
    var out = new ArrayList<Want>(size);
    for (var i = 0; out.size() < size; i++) {
      out.add(attack(strategy, i, closing));
    }
    var defenders = defenders(size, field);
    return defenders > 0 && !closing ? balanceDefenders(out, defenders) : out;
  }

  /**
   * How many anchors a team of {@code size} keeps home on a field {@code field} ticks long: about
   * one in four from four bots up; on a field longer than {@link #RETAKE_REACH}, from three bots up
   * and up to {@link #MAX_STRETCH} times as many, as a retake from up such a field comes too late.
   */
  public static int defenders(int size, double field) {
    var stretched = field > RETAKE_REACH;
    if (size < (stretched ? 3 : 4)) return 0;
    var stretch = Math.clamp(field / RETAKE_REACH, 1, MAX_STRETCH);
    return Math.max(1, (int) Math.round(size / 4.0 * stretch));
  }

  /**
   * The {@code i}th want with an objective: a further planter at every {@link #PLANTER_EVERY}th
   * place, a fixed place so its slot key stays put as the team shrinks.
   */
  private static Want attack(Strategy strategy, int i, boolean closing) {
    if (i >= PLANTER_EVERY && i % PLANTER_EVERY == 0) {
      var left = (i / PLANTER_EVERY) % 2 == 1;
      return Want.of(SlotKind.PLANT, left ? Lanes.Which.LEFT : Lanes.Which.RIGHT);
    }
    return closing ? close(i) : want(strategy, i);
  }

  /** How many planters a team of {@code size} deals with an objective. */
  public static int planters(int size) {
    return 1 + Math.max(0, size - 1) / PLANTER_EVERY;
  }

  private static List<Want> balanceDefenders(List<Want> wants, int desired) {
    var out = new ArrayList<>(wants);
    var present = (int) out.stream().filter(want -> want.kind() == SlotKind.ANCHOR).count();
    for (var index = out.size() - 1; index >= 0 && present > desired; index--) {
      if (out.get(index).kind() == SlotKind.ANCHOR) {
        // Reserve defenders rotate round the flank; another ranked midpoint lane can stop
        // short of the assault line while duplicating its existing holders.
        out.set(index, Want.of(SlotKind.FLANK, cycle(index)));
        present--;
      }
    }
    while (present < desired) {
      var index = defenderConversion(out);
      out.set(index, Want.of(SlotKind.ANCHOR, Lanes.Which.MIDDLE));
      present++;
    }
    return out;
  }

  /** Preserve the last attacker on either side; spare an escort before abandoning a route. */
  private static int defenderConversion(List<Want> wants) {
    for (var index = wants.size() - 1; index >= 0; index--) {
      var candidate = wants.get(index);
      if (fieldAttacker(candidate)
          && wants.stream()
                  .filter(Playbook::fieldAttacker)
                  .filter(want -> want.which() == candidate.which())
                  .count()
              > 1) return index;
    }
    for (var index = wants.size() - 1; index >= 0; index--) {
      if (wants.get(index).kind() == SlotKind.ESCORT) return index;
    }
    for (var index = wants.size() - 1; index >= 0; index--) {
      if (fieldAttacker(wants.get(index))) return index;
    }
    throw new IllegalStateException("a playbook cannot allocate its defender without an attacker");
  }

  private static boolean fieldAttacker(Want want) {
    return switch (want.kind()) {
      case LANE, FLANK, SWEEP -> true;
      default -> false;
    };
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
      case 4 -> Want.paired(SlotKind.FLANK, Lanes.Which.RIGHT, 2);
      case 5 -> Want.paired(SlotKind.FLANK, Lanes.Which.LEFT, 2);
      case 6 -> Want.of(SlotKind.OVERWATCH, Lanes.Which.MIDDLE);
      case 7 -> Want.of(SlotKind.ANCHOR, Lanes.Which.MIDDLE);
      default -> Want.of(SlotKind.LANE, cycle(i));
    };
  }

  private static Want turtle(int i) {
    return switch (i) {
      case 0 -> new Want(SlotKind.ANCHOR, Lanes.Which.MIDDLE, -1, Role.RETAKE, 0);
      case 1 -> Want.of(SlotKind.PLANT, Lanes.Which.RIGHT);
      case 2 -> Want.of(SlotKind.OVERWATCH, Lanes.Which.MIDDLE);
      case 3 -> Want.of(SlotKind.ANCHOR, Lanes.Which.MIDDLE);
      case 4 -> Want.paired(SlotKind.LANE, Lanes.Which.LEFT, 1);
      case 5 -> Want.paired(SlotKind.LANE, Lanes.Which.RIGHT, 2);
      case 6 -> Want.of(SlotKind.ANCHOR, Lanes.Which.MIDDLE);
      case 7 -> Want.of(SlotKind.FLANK, Lanes.Which.LEFT);
      default ->
          i % 2 == 0
              ? Want.of(SlotKind.ANCHOR, Lanes.Which.MIDDLE)
              : Want.of(SlotKind.LANE, cycle(i));
    };
  }

  /**
   * Closing out the round: the planter with its wedge, sweeping pairs on both sides after the last
   * enemies, and one anchor in case they make for the own bomb.
   */
  private static Want close(int i) {
    return switch (i) {
      case 0 -> Want.of(SlotKind.PLANT, Lanes.Which.MIDDLE);
      case 1 -> Want.escort(ESCORT_SIDE);
      case 2, 3 -> Want.paired(SlotKind.SWEEP, Lanes.Which.LEFT, 0);
      case 4, 5 -> Want.paired(SlotKind.SWEEP, Lanes.Which.RIGHT, 1);
      case 6 -> Want.of(SlotKind.ANCHOR, Lanes.Which.MIDDLE);
      case 7 -> Want.escort(-ESCORT_SIDE);
      default -> Want.paired(SlotKind.SWEEP, cycle(i), i / 2);
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

  /**
   * Deals {@code setup.size()} slots; with a {@link Setup#held} nuke, one of them is {@link #HOLD}
   * beside it, unless the team's one bot is arming it.
   */
  public static List<Slot> deal(Setup setup) {
    var deal = new Deal(setup);
    var wants =
        setup.objective().isPresent()
            ? attacking(setup.strategy(), setup.size(), setup.closing(), setup.field())
            : wants(setup.strategy(), setup.size(), false, setup.closing());
    var arming =
        setup.held().isPresent()
            && setup.objective().map(BombView::id).equals(setup.held().map(BombView::id));
    var hold = setup.held().isPresent() && !(wants.size() == 1 && arming) ? holdIndex(wants) : -1;
    var slots = new ArrayList<Slot>(setup.size());
    for (var index = 0; index < wants.size(); index++) {
      slots.add(
          index == hold ? deal.hold(setup.held().orElseThrow()) : deal.slot(wants.get(index)));
    }
    return slots;
  }

  /**
   * The want the nuke's guard replaces: a field attacker its side can spare, else an escort, else
   * any field attacker, else overwatch, else a further anchor, else the last want (a lone bot's).
   */
  static int holdIndex(List<Want> wants) {
    for (var index = wants.size() - 1; index >= 0; index--) {
      var candidate = wants.get(index);
      if (fieldAttacker(candidate)
          && wants.stream()
                  .filter(Playbook::fieldAttacker)
                  .filter(want -> want.which() == candidate.which())
                  .count()
              > 1) return index;
    }
    for (var kind : List.of(SlotKind.ESCORT, SlotKind.LANE, SlotKind.FLANK, SlotKind.SWEEP)) {
      var index = lastOf(wants, kind, 0);
      if (index >= 0) return index;
    }
    var overwatch = lastOf(wants, SlotKind.OVERWATCH, 0);
    if (overwatch >= 0) return overwatch;
    var anchor = lastOf(wants, SlotKind.ANCHOR, 1);
    return anchor >= 0 ? anchor : wants.size() - 1;
  }

  /** The last want of {@code kind} past the first {@code skip} of them, or -1. */
  private static int lastOf(List<Want> wants, SlotKind kind, int skip) {
    var seen = (int) wants.stream().filter(want -> want.kind() == kind).count();
    for (var index = wants.size() - 1; index >= 0 && seen > skip; index--) {
      if (wants.get(index).kind() == kind) return index;
    }
    return -1;
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
      this.push = setup.push();
    }

    /** What the team is heading for: the objective, else the latest sighting, else their home. */
    private Vec3 target() {
      return setup
          .objective()
          .map(BombView::pos)
          .or(() -> setup.sightings().stream().findFirst())
          .orElseGet(setup::enemyHome);
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

    /**
     * The planter goes with the team: it stands on its lane at the push until the push reaches
     * {@link #PLANT_GO}, then makes for the bomb.
     */
    private Slot plant(String key, Want want) {
      var bomb = setup.objective().orElseThrow();
      var lane = laneIndex(want.which());
      // A held nuke is armed from beside it, where its guard stands, whatever the push.
      var at =
          push >= PLANT_GO || setup.held().map(BombView::id).filter(bomb.id()::equals).isPresent()
              ? place(approach(bomb))
              : place(setup.lanes().get(lane).at(Math.max(LANE_NEAREST, push + AHEAD)));
      return new Slot(
          key,
          SlotKind.PLANT,
          want.role(),
          at,
          bomb.pos(),
          lane,
          want.pair(),
          Optional.of(bomb.id()),
          0);
    }

    private Vec3 approach(BombView bomb) {
      var node = setup.nav().bombApproach(BlockPos.of(bomb.pos()));
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
      var progress = Math.clamp(push + AHEAD - RANK_BEHIND * rank, LANE_NEAREST, MAX_PUSH);
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
      var progress = Math.clamp(push + FLANK_AHEAD, LANE_NEAREST, MAX_PUSH + FLANK_AHEAD);
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
      var field = setup.enemyHome().minus(setup.home()).horizontal();
      var length = Math.max(1, field.length());
      var forward = field.isZero() ? axis : field.normalized();
      Optional<Vec3> best = Optional.empty();
      var bestScore = Double.NEGATIVE_INFINITY;
      for (var point : setup.nav().cover().points()) {
        var feet = graph.feet(point.node());
        var distance = feet.horizontalDistance(objective);
        // Measured along the whole field, so a near objective (the nuke) does not pull the
        // overwatch back into its own base.
        var along = feet.minus(setup.home()).horizontal().dot(forward) / length;
        var sees =
            target.isEmpty()
                || regions.canSee(
                    regions.regionOf(point.node()), regions.regionOf(target.getAsInt()));
        if (wet(feet)
            || distance < OVERWATCH_MIN
            || distance > OVERWATCH_MAX
            || along > OVERWATCH_FURTHEST
            || feet.horizontalDistance(setup.home()) < OVERWATCH_OUT
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
      var screen =
          bestAnchor(
              guard,
              facing,
              new Band(Math.max(setup.guardClear(), ANCHOR_MIN), ANCHOR_MAX, false, true),
              coverNodes());
      // The first anchor holds home only where the screen would leave the bomb out of reach: on
      // the training yard's flat ground a screening anchor already stands within range, and holding
      // it at the bomb's back cost plants (ObjectivePlayTest).
      var covered = screen.filter(point -> point.distance(guard) <= HOME_RANGE).isPresent();
      var home = index == 0 && !covered ? home(guard, facing) : Optional.<Vec3>empty();
      var at =
          home.or(() -> screen).map(this::keep).orElseGet(() -> place(ring(guard, facing, index)));
      var direction = at.minus(guard).horizontal();
      var out = direction.isZero() ? facing : direction.normalized();
      anchorDirections.add(out);
      // The home anchor stands at the bomb's back and watches past it towards the threat.
      var watch = home.isPresent() ? guard.plus(facing.scale(16)) : at.plus(out.scale(16));
      return new Slot(
          key, SlotKind.ANCHOR, want.role(), at, watch, -1, want.pair(), Optional.empty(), 0);
    }

    /**
     * How far from the bomb an anchor may stand.
     *
     * @param least the nearest
     * @param most the furthest
     * @param close whether the distance is measured in three dimensions, so cover on a ledge above
     *     or below the bomb is not counted as close to it
     * @param spreading whether the anchor spreads from the other anchors' approaches, as the own
     *     bomb's do; a nuke's guard has none
     */
    private record Band(double least, double most, boolean close, boolean spreading) {

      double distance(Vec3 feet, Vec3 guard) {
        return close ? feet.distance(guard) : feet.minus(guard).horizontal().length();
      }
    }

    /**
     * The first anchor's place: within {@link #HOME_HOLD} of the bomb, on cover if there is any
     * there, else on any walkable node, so a lit fuse always has a teammate beside it. It stands on
     * the side away from the threat: the bomb usually sits in the base, and in front of it lies the
     * team's way out (the training yard's spawns ring its bombs). Empty when the team has no bomb
     * to guard (its anchors hold home), when poison keeps anchors further out, or when nothing
     * walkable lies that close.
     */
    private Optional<Vec3> home(Vec3 guard, Vec3 facing) {
      var band = new Band(Math.max(setup.guardClear(), HOME_NEAREST), HOME_HOLD, true, true);
      if (band.least() >= band.most() || setup.nav().bombApproach(BlockPos.of(guard)).isEmpty())
        return Optional.empty();
      var back = facing.scale(-1);
      return bestAnchor(guard, back, band, coverNodes())
          .or(() -> bestAnchor(guard, back, band, nodesAround(guard, band)));
    }

    /**
     * The nuke's guard: an anchor within {@link #HOME_HOLD} of the held nuke facing the threat, on
     * cover if any lies there, so whoever defused or armed it stays to fight the side that comes to
     * arm or defuse it again.
     */
    Slot hold(BombView nuke) {
      var threat = setup.sightings().stream().findFirst().orElseGet(setup::enemyHome);
      var toEnemy = threat.minus(nuke.pos()).horizontal();
      var facing = toEnemy.isZero() ? axis : toEnemy.normalized();
      var band = new Band(HOME_NEAREST, HOME_HOLD, true, false);
      var at =
          bestAnchor(nuke.pos(), facing, band, coverNodes())
              .or(() -> bestAnchor(nuke.pos(), facing, band, nodesAround(nuke.pos(), band)))
              .map(this::keep)
              .orElseGet(() -> place(approach(nuke)));
      return new Slot(
          HOLD,
          SlotKind.ANCHOR,
          Role.DEFEND,
          at,
          at.plus(facing.scale(16)),
          -1,
          -1,
          Optional.of(nuke.id()),
          0);
    }

    private List<Integer> coverNodes() {
      return setup.nav().cover().points().stream().map(point -> point.node()).toList();
    }

    /** The walkable nodes found on rings about {@code guard} within {@code band}. */
    private List<Integer> nodesAround(Vec3 guard, Band band) {
      var out = new ArrayList<Integer>();
      var seen = new HashSet<Integer>();
      for (var radius = (int) Math.ceil(band.least()); radius <= band.most(); radius++) {
        var steps = 8 * radius;
        for (var k = 0; k < steps; k++) {
          var angle = 2 * Math.PI * k / steps;
          var probe = guard.plus(StrictMath.cos(angle) * radius, 0, StrictMath.sin(angle) * radius);
          var node = graph.nearestNodeWithin(probe, 2);
          if (node.isPresent() && seen.add(node.getAsInt())) out.add(node.getAsInt());
        }
      }
      return out;
    }

    /**
     * The best of {@code nodes} for an anchor within {@code band} of {@code guard}: dry, spaced
     * from the slots dealt, off the team's way out, spread from the other anchors and facing the
     * threat.
     */
    private Optional<Vec3> bestAnchor(Vec3 guard, Vec3 facing, Band band, List<Integer> nodes) {
      var bomb = setup.nav().bombApproach(BlockPos.of(guard));
      var anchorage = bomb.isPresent() ? bomb : graph.nearestNodeWithin(guard, SNAP * 2);
      Optional<Vec3> best = Optional.empty();
      var bestScore = Double.NEGATIVE_INFINITY;
      for (var node : nodes) {
        var feet = graph.feet(node);
        var distance = band.distance(feet, guard);
        if (wet(feet)
            || distance < band.least()
            || distance > band.most()
            || nearestPlaced(feet) < SPACING
            || onWayOut(node, feet)
            || !roundTrip(anchorage, node)) {
          continue;
        }
        var offset = feet.minus(guard).horizontal();
        var direction = offset.isZero() ? facing : offset.normalized();
        var score =
            (band.spreading() ? spread(direction) : 0)
                + 0.2 * direction.dot(facing)
                - 0.02 * distance;
        if (score > bestScore) {
          bestScore = score;
          best = Optional.of(feet);
        }
      }
      return best;
    }

    /**
     * Whether an anchor at {@code node} can walk to the bomb it holds ({@code anchorage}, its
     * approach) and back. The-harshest-harvest: anchors were dealt cover on a ledge beside red's
     * bomb that no path reaches, and their holders stepped about in recovery all match.
     */
    private boolean roundTrip(java.util.OptionalInt anchorage, int node) {
      if (anchorage.isEmpty()) return true;
      var bomb = anchorage.getAsInt();
      return graph.reachable(bomb, node) && graph.reachable(node, bomb);
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
      var radius = Math.max(setup.guardClear() + 1, ANCHOR_MIN);
      var angle =
          StrictMath.atan2(facing.z(), facing.x()) + (index % 2 == 0 ? 1 : -1) * (index + 1) * 0.6;
      return guard.plus(new Vec3(StrictMath.cos(angle), 0, StrictMath.sin(angle)).scale(radius));
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
      // A broad region centroid can erase distinct opening lanes; only an actual sighting is
      // searched by region. Until contact, sweep the authored route itself.
      var centre =
          pair < sightings.size() && node.isPresent()
              ? regions.centroid(regions.regionOf(node.getAsInt()))
              : target;
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

    /**
     * Whether a bot standing at {@code feet} would tread water: a slot there is held swimming in
     * place, which reads as a bot stuck in water.
     */
    private boolean wet(Vec3 feet) {
      return graph.water().contains(BlockPos.of(feet.plus(0, 0.001, 0)));
    }

    private Vec3 snap(Vec3 point) {
      var node = graph.nearestNodeWithin(point, SNAP * 2);
      return node.isPresent() ? graph.feet(node.getAsInt()) : point;
    }

    /**
     * The walkable point out of water nearest {@code desired} at least {@link #SPACING} from every
     * slot. Crowding a teammate beats treading water: with no dry point spaced from the others, the
     * nearest dry one.
     */
    private Vec3 place(Vec3 desired) {
      var base = snap(desired);
      if (!wet(base) && nearestPlaced(base) >= SPACING) {
        return keep(base);
      }
      var tried = new HashSet<Integer>();
      var dry = wet(base) ? Optional.<Vec3>empty() : Optional.of(base);
      for (var ring = 1; ring <= SEARCH_RINGS; ring++) {
        for (var feet : ring(desired, ring, tried)) {
          if (nearestPlaced(feet) >= SPACING) {
            return keep(feet);
          }
          if (dry.isEmpty()) dry = Optional.of(feet);
        }
      }
      for (var ring = 1; dry.isEmpty() && ring <= DRY_RINGS; ring++) {
        dry = ring(base, ring, tried).stream().findFirst();
      }
      return keep(dry.orElse(base));
    }

    /** The dry, not yet tried walkable points on the ring {@code radius} blocks about a centre. */
    private List<Vec3> ring(Vec3 centre, int radius, Set<Integer> tried) {
      var points = new ArrayList<Vec3>();
      var steps = 8 * radius;
      for (var k = 0; k < steps; k++) {
        var angle = 2 * Math.PI * k / steps;
        var probe = centre.plus(StrictMath.cos(angle) * radius, 0, StrictMath.sin(angle) * radius);
        var node = graph.nearestNodeWithin(probe, 1);
        if (node.isEmpty() || !tried.add(node.getAsInt())) {
          continue;
        }
        var feet = graph.feet(node.getAsInt());
        if (!wet(feet)) points.add(feet);
      }
      return points;
    }
  }

  /** The wedge point {@code side} blocks beside and a few behind {@code planter}. */
  public static Vec3 escortPoint(Vec3 planter, Vec3 heading, double side) {
    var perpendicular = new Vec3(-heading.z(), 0, heading.x());
    return planter.minus(heading.scale(ESCORT_BEHIND)).plus(perpendicular.scale(side));
  }
}
