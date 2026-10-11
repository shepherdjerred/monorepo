package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.CoverPoints;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Lane;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Playbook;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Slot;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.function.IntToDoubleFunction;
import java.util.function.Predicate;

/**
 * Turns a chosen option into a short plan, knows when a step is finished, and turns the current
 * step into a {@link Decision} with a path.
 *
 * <p>Slot options follow the playbook: with no enemy known a bot runs to its slot along its lane
 * and holds it watching the slot's threat; once enemies are known it advances by bounds from cover
 * to cover (paired slots take turns, one moving while the other holds) and holds its slot from
 * cover. Paths carry per-bot penalties ({@link RoutePenalty}), and a team's last survivor also pays
 * for every region a known enemy could watch, so the last man sneaks rather than runs.
 */
public final class Planner {

  /** A route step is done within this horizontal distance of its goal. */
  public static final double ROUTE_REACHED = 1.2;

  /** Fleeing is done once no known enemy is within this distance. */
  public static final double FLEE_RANGE = 12;

  /** How far away cover is looked for when fleeing or healing. */
  public static final double COVER_SEARCH = 16;

  /** Extra path cost per unit of exposure to enemy regions when sneaking. */
  public static final double STEALTH_PENALTY = 4;

  /** How far from an own bomb poison escape aims for, beyond the poison radius. */
  public static final double POISON_MARGIN = 4;

  /** How long one bound of a cover-to-cover advance lasts, in ticks. */
  public static final long BOUND_TICKS = 40;

  /** Hunters close on a remembered enemy from points this far round it, not in single file. */
  static final double HUNT_RING = 3;

  /** How far from their bomb defenders spread when it is threatened. */
  static final double RETAKE_RING = 3.5;

  /** Successive bots' retake angles differ by the golden angle, so any few spread round. */
  static final double GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

  /** How far one bound reaches towards the slot, in blocks. */
  public static final double BOUND_STEP = 7;

  /** How far around a bound's end point cover is looked for. */
  static final double BOUND_SEARCH = 5;

  /** How far from the bot a bound looks for cover when none lies one step ahead. */
  static final double BOUND_REACH = 12;

  /** How far an archer looks for the edge of cover to shoot from. */
  static final double PEEK_SEARCH = 8;

  /** An archer this close to a teammate steps aside before it shoots. */
  static final double ARCHER_ROOM = 2.5;

  /** A bound ends this close to its cover point, inside the cover's block. */
  static final double COVER_REACHED = 0.5;

  /** How much further from its goal a bot caught in the open will run to reach cover. */
  static final double GIVE_GROUND = 2;

  /** A bot this close to cover counts as in it. */
  static final double IN_COVER = 1.5;

  /** How far around a held point cover is looked for. */
  static final double HOLD_SEARCH = 6;

  /** How long a bot holds cover at its slot before looking again, in ticks. */
  static final long HOLD_COVER_TICKS = 40;

  /** A beat to settle into cover after a bound, in ticks. */
  static final long SETTLE_TICKS = 10;

  /** Roughly how far a bot walks per tick, to time a bound. */
  static final double WALK_PER_TICK = 0.2;

  /** A bot this close to its team's spawn is still leaving it. */
  public static final double SPAWN_CLEAR = 12;

  /**
   * Bounds never end within this distance of the team's spawn: its doorway and the cover just
   * outside.
   */
  static final double DOORWAY_CLEAR = 8;

  /** An enemy this close pins a pair down: they take turns to move. */
  static final double PINNED_RANGE = 12;

  /** An enemy within this distance turns slot moves into bounds from cover to cover. */
  public static final double CONTACT_RANGE = 24;

  /** A sword only takes a swing from cover at an enemy this close. */
  static final double CLOSE_FIGHT = 4;

  /** Cover this close to a teammate, or to cover a teammate claimed, is theirs. */
  static final double COVER_ROOM = 2.5;

  /** Cover this close to an enemy is no cover. */
  static final double TOO_CLOSE_COVER = 4;

  private static final String REWIND = "rewind";
  private static final int SNAP = 3;

  private Planner() {}

  /** The plan carrying out {@code option} from {@code situation}. */
  public static Plan expand(Option option, Situation situation, TacticsContext context) {
    var now = situation.now();
    return switch (option) {
      case ARM ->
          situation
              .plantTarget()
              .or(situation::nearestArmableBomb)
              .map(bomb -> bombPlan(option, situation, context, bomb))
              .orElseGet(() -> holdHere(option, situation, context));
      case HELP_ARM ->
          situation
              .bombBeingArmedByUs()
              .map(bomb -> bombPlan(option, situation, context, bomb))
              .orElseGet(() -> holdHere(option, situation, context));
      case DEFUSE ->
          situation
              .litOwnBomb()
              .map(bomb -> defusePlan(now, bomb, context.nav()))
              .orElseGet(() -> holdHere(option, situation, context));
      case RETAKE -> retake(situation, context);
      case ENGAGE ->
          situation.chaseableEnemies().stream()
              .findFirst()
              .map(enemy -> Plan.of(option, now, new PlanStep.Fight(enemy.id())))
              .orElseGet(() -> holdHere(option, situation, context));
      case RETREAT -> {
        var cover = safeSpot(situation, context);
        yield Plan.of(option, now, new PlanStep.Flee(cover.pos(), cover.claim()));
      }
      case HEAL -> {
        var cover = safeSpot(situation, context);
        yield Plan.of(option, now, new PlanStep.Heal(cover.pos(), cover.claim()));
      }
      case TAKE_SLOT -> takeSlot(situation, context);
      case HOLD_SLOT -> holdSlot(situation, context);
      case HOLD_ANGLE -> holdHere(option, situation, context);
      case HUNT ->
          situation
              .nearestEnemy()
              .map(
                  enemy ->
                      Plan.of(
                          option,
                          now,
                          new PlanStep.Route(
                              around(situation, context, enemy.pos(), HUNT_RING),
                              stanceFor(situation, context))))
              .orElseGet(() -> holdHere(option, situation, context));
      case ESCAPE_POISON ->
          Plan.of(option, now, new PlanStep.Route(poisonExit(situation, context), Stance.CAUTIOUS));
      case REWIND ->
          Plan.of(
              option,
              now,
              new PlanStep.Ability(REWIND),
              new PlanStep.Flee(safeSpot(situation, context).pos(), Optional.empty()));
    };
  }

  private static Stance stanceFor(Situation situation, TacticsContext context) {
    if (situation.isLastAlive()) {
      return Stance.STEALTH;
    }
    return context.style().aggression() > 0.6 ? Stance.AGGRESSIVE : Stance.CAUTIOUS;
  }

  /** Route to the bomb and arm it; helpers walk carefully, planters at their own pace. */
  private static Plan bombPlan(
      Option option, Situation situation, TacticsContext context, BombView bomb) {
    var stance = option == Option.HELP_ARM ? Stance.CAUTIOUS : stanceFor(situation, context);
    return Plan.of(
        option,
        situation.now(),
        new PlanStep.Route(approach(context.nav(), bomb), stance),
        new PlanStep.Arm(bomb.id()));
  }

  private static Plan defusePlan(long now, BombView bomb, NavArtifact nav) {
    return Plan.of(
        Option.DEFUSE,
        now,
        new PlanStep.Route(approach(nav, bomb), Stance.AGGRESSIVE),
        new PlanStep.Defuse(bomb.id()));
  }

  private static Plan retake(Situation situation, TacticsContext context) {
    var bomb = situation.nearestOwnBomb();
    if (bomb.isEmpty()) {
      return holdHere(Option.RETAKE, situation, context);
    }
    var threat =
        situation
            .nearestEnemy()
            .filter(
                enemy ->
                    enemy.pos().distance(bomb.orElseThrow().pos()) <= Features.BOMB_THREAT_RANGE);
    if (threat.isPresent() && !context.keep().ranged()) {
      return Plan.of(Option.RETAKE, situation.now(), new PlanStep.Fight(threat.orElseThrow().id()));
    }
    var at = retakePoint(situation, context, bomb.get());
    var watch =
        situation.nearestEnemy().map(Situation.KnownEnemy::pos).orElseGet(() -> at.plus(1, 0, 0));
    return Plan.of(
        Option.RETAKE,
        situation.now(),
        new PlanStep.Route(at, Stance.AGGRESSIVE),
        new PlanStep.Hold(at, watch, Stance.AGGRESSIVE));
  }

  /**
   * Where a bot answering a threat to its bomb stands: on a ring round the bomb at its own angle,
   * so defenders surround the bomb instead of stacking on one block.
   */
  private static Vec3 retakePoint(Situation situation, TacticsContext context, BombView bomb) {
    return around(situation, context, bomb.pos().plus(0, -0.5, 0), RETAKE_RING);
  }

  /** The walkable point {@code radius} from {@code centre} at the bot's own angle. */
  private static Vec3 around(
      Situation situation, TacticsContext context, Vec3 centre, double radius) {
    var angle = situation.self().id().value() * GOLDEN_ANGLE;
    var point =
        centre.plus(new Vec3(StrictMath.cos(angle), 0, StrictMath.sin(angle)).scale(radius));
    var graph = context.nav().graph();
    var node = graph.nearestNodeWithin(point, SNAP);
    return node.isPresent() ? graph.feet(node.getAsInt()) : centre;
  }

  private static Plan holdHere(Option option, Situation situation, TacticsContext context) {
    var self = situation.self();
    var watch =
        situation
            .nearestEnemy()
            .map(Situation.KnownEnemy::pos)
            .or(() -> situation.slot().map(Slot::watch))
            .or(() -> enemySpawn(situation, context))
            .orElseGet(() -> self.pos().plus(self.facing().direction().scale(8)));
    var stance = situation.isLastAlive() ? Stance.STEALTH : Stance.CAUTIOUS;
    return Plan.of(option, situation.now(), new PlanStep.Hold(self.pos(), watch, stance));
  }

  // ---- slots -----------------------------------------------------------------------------------

  /**
   * Where the bot's slot stands now: an escort's wedge point moves with the planter, every other
   * slot stays where it was dealt.
   */
  public static Optional<Vec3> slotPoint(Situation situation, TacticsContext context) {
    return situation.slot().map(slot -> slotPoint(situation, context, slot));
  }

  private static Vec3 slotPoint(Situation situation, TacticsContext context, Slot slot) {
    if (slot.kind() != SlotKind.ESCORT) {
      return slot.pos();
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
    var node = graph.nearestNodeWithin(point, SNAP);
    return node.isPresent() ? graph.feet(node.getAsInt()) : point;
  }

  private static Plan takeSlot(Situation situation, TacticsContext context) {
    var slot = situation.slot();
    if (slot.isEmpty()) {
      return holdHere(Option.TAKE_SLOT, situation, context);
    }
    var goal = slotPoint(situation, context, slot.orElseThrow());
    var threat = contact(situation);
    if (threat.isPresent()) {
      return bound(situation, context, goal, threat.orElseThrow());
    }
    var stance = situation.isLastAlive() ? Stance.STEALTH : Stance.AGGRESSIVE;
    return Plan.of(
        Option.TAKE_SLOT,
        situation.now(),
        new PlanStep.Route(goal, stance),
        new PlanStep.Hold(goal, slot.orElseThrow().watch(), Stance.CAUTIOUS));
  }

  private static Plan holdSlot(Situation situation, TacticsContext context) {
    var slot = situation.slot();
    if (slot.isEmpty()) {
      return holdHere(Option.HOLD_SLOT, situation, context);
    }
    var goal = slotPoint(situation, context, slot.orElseThrow());
    var threat = contact(situation);
    var now = situation.now();
    if (threat.isEmpty()) {
      var stance = situation.isLastAlive() ? Stance.STEALTH : Stance.CAUTIOUS;
      return Plan.of(
          Option.HOLD_SLOT, now, new PlanStep.Hold(goal, slot.orElseThrow().watch(), stance));
    }
    var cover =
        heldCover(situation, context, goal, threat.orElseThrow())
            .or(
                () ->
                    coverNear(
                        situation,
                        context,
                        new CoverSearch(goal, threat.orElseThrow(), HOLD_SEARCH)))
            .or(
                () ->
                    coverNear(
                        situation,
                        context,
                        new CoverSearch(
                            situation.self().pos(), threat.orElseThrow(), BOUND_REACH)));
    return cover
        .map(
            point ->
                Plan.of(
                    Option.HOLD_SLOT,
                    now,
                    new PlanStep.Cover(
                        Optional.of(point.node()),
                        point.pos(),
                        threat.orElseThrow(),
                        now + HOLD_COVER_TICKS)))
        .orElseGet(
            () ->
                Plan.of(
                    Option.HOLD_SLOT,
                    now,
                    new PlanStep.Hold(goal, threat.orElseThrow(), Stance.CAUTIOUS)));
  }

  /**
   * One bound towards {@code goal} under {@code threat}: the mover heads for the next cover that
   * gets it closer, the holder settles into cover where it is until the window turns.
   */
  private static Plan bound(Situation situation, TacticsContext context, Vec3 goal, Vec3 threat) {
    var now = situation.now();
    var self = situation.self().pos();
    var remaining = goal.horizontalDistance(self);
    // Under fire from close by, pairs take turns; further off, the bot keeps moving up but goes
    // from one piece of cover to the next instead of across open ground.
    var pinned = threat.horizontalDistance(self) <= PINNED_RANGE;
    var here = coverNear(situation, context, new CoverSearch(self, threat, IN_COVER));
    if (here.isEmpty()) {
      // Caught in the open: the nearest cover that does not give up ground, whoever's turn it is.
      var nearby =
          coverWhere(
              situation,
              context,
              new CoverSearch(self, threat, BOUND_REACH),
              feet ->
                  feet.horizontalDistance(goal) <= remaining + GIVE_GROUND
                      && clearOfSpawn(situation, feet));
      if (nearby.isPresent()) {
        return toCover(now, self, nearby.orElseThrow(), threat);
      }
    }
    var window = now / BOUND_TICKS;
    if (pinned && !mover(situation, window)) {
      var until = (window + 1) * BOUND_TICKS;
      return Plan.of(
          Option.TAKE_SLOT,
          now,
          here.map(
                  point ->
                      new PlanStep.Cover(Optional.of(point.node()), point.pos(), threat, until))
              .orElseGet(() -> new PlanStep.Cover(Optional.empty(), self, threat, until)));
    }
    var next = nextCover(situation, context, goal, threat);
    if (next.isPresent()) {
      return toCover(now, self, next.orElseThrow(), threat);
    }
    var toGoal = goal.minus(self).horizontal();
    var step =
        toGoal.length() <= BOUND_STEP ? goal : self.plus(toGoal.normalized().scale(BOUND_STEP));
    return Plan.of(
        Option.TAKE_SLOT,
        now,
        new PlanStep.Route(step, pinned ? Stance.CAUTIOUS : Stance.AGGRESSIVE));
  }

  /** A dash to {@code point}, then a beat in it. */
  private static Plan toCover(long now, Vec3 self, CoverSpot point, Vec3 threat) {
    var travel = (long) Math.ceil(point.pos().horizontalDistance(self) / WALK_PER_TICK);
    return Plan.of(
        Option.TAKE_SLOT,
        now,
        new PlanStep.Cover(
            Optional.of(point.node()), point.pos(), threat, now + travel + SETTLE_TICKS));
  }

  /**
   * Whether the bot moves this window: paired bots take turns, a bot without a living partner moves
   * two windows in three.
   */
  static boolean mover(Situation situation, long window) {
    var self = situation.self().id();
    var partners =
        situation.board().plan().partners(self).stream()
            .filter(
                id -> situation.snapshot().combatant(id).map(CombatantView::alive).orElse(false))
            .toList();
    if (partners.isEmpty()) {
      return window % 3 != 2;
    }
    var ids = new ArrayList<CombatantId>(partners);
    ids.add(self);
    ids.sort(null);
    return (window + ids.indexOf(self)) % 2 == 0;
  }

  /**
   * The nearest known enemy close enough to change how the bot moves: within {@link
   * #CONTACT_RANGE}. One seen across the map is not a reason to crawl from cover to cover, and a
   * bot still leaving its spawn clears it first rather than queueing for cover in the doorway.
   */
  static Optional<Vec3> contact(Situation situation) {
    var self = situation.self().pos();
    // Only enemies the bot saw itself: a teammate's call is no reason to go to ground.
    var own =
        situation.knownEnemies().stream()
            .filter(enemy -> enemy.visible() || enemy.confidence() > Situation.SHARED_CONFIDENCE)
            .findFirst();
    var leaving =
        situation
            .board()
            .plan()
            .home()
            .filter(home -> home.horizontalDistance(self) < SPAWN_CLEAR)
            .isPresent();
    return own.map(Situation.KnownEnemy::pos)
        .filter(pos -> !leaving && pos.horizontalDistance(self) <= CONTACT_RANGE);
  }

  /**
   * The cover the bot already holds at its slot, while it still hides it from {@code threat}: a
   * holder stays put rather than shopping for cover every few seconds.
   */
  private static Optional<CoverSpot> heldCover(
      Situation situation, TacticsContext context, Vec3 goal, Vec3 threat) {
    var nav = context.nav();
    var node = situation.board().claimedCover().get(situation.self().id());
    if (node == null) {
      return Optional.empty();
    }
    var feet = nav.graph().feet(node);
    return nav.cover().points().stream()
        .filter(point -> point.node() == node)
        .findFirst()
        .filter(point -> point.protectsStanding(CoverPoints.sectorOf(feet, threat)))
        .filter(point -> feet.horizontalDistance(goal) <= HOLD_SEARCH + 1)
        .map(point -> new CoverSpot(node, feet));
  }

  /** A cover point and where to stand at it. */
  record CoverSpot(int node, Vec3 pos) {

    /** The node to claim, when this is cover rather than a place to run to. */
    Optional<Integer> claim() {
      return node < 0 ? Optional.empty() : Optional.of(node);
    }
  }

  /**
   * Where to look for cover.
   *
   * @param near the point to look around
   * @param threat what the cover must hide from
   * @param radius how far from {@code near} to look
   */
  record CoverSearch(Vec3 near, Vec3 threat, double radius) {}

  /** Unclaimed cover from {@code search}'s threat around its point, nearest first. */
  static Optional<CoverSpot> coverNear(
      Situation situation, TacticsContext context, CoverSearch search) {
    return coverWhere(situation, context, search, feet -> true);
  }

  private static Optional<CoverSpot> coverWhere(
      Situation situation, TacticsContext context, CoverSearch search, Predicate<Vec3> wanted) {
    var near = search.near();
    var threat = search.threat();
    var radius = search.radius();
    var nav = context.nav();
    var self = situation.self().id();
    var taken = new ArrayList<Vec3>();
    for (var ally : situation.livingAllies()) {
      taken.add(ally.pos());
    }
    situation
        .board()
        .claimedCover()
        .forEach(
            (bot, node) -> {
              if (!bot.equals(self)) {
                taken.add(nav.graph().feet(node));
              }
            });
    for (var point : nav.cover().protectingFrom(nav.graph(), near, threat, radius)) {
      var feet = nav.graph().feet(point.node());
      if (situation.board().isCoverClaimed(point.node(), self)
          || feet.horizontalDistance(threat) <= TOO_CLOSE_COVER
          || taken.stream().anyMatch(other -> other.horizontalDistance(feet) < COVER_ROOM)
          || !wanted.test(feet)) {
        continue;
      }
      return Optional.of(new CoverSpot(point.node(), feet));
    }
    return Optional.empty();
  }

  /** The next cover towards {@code goal}: around a point one bound ahead, and closer than now. */
  private static Optional<CoverSpot> nextCover(
      Situation situation, TacticsContext context, Vec3 goal, Vec3 threat) {
    var self = situation.self().pos();
    var toGoal = goal.minus(self).horizontal();
    var remaining = toGoal.length();
    var probe = remaining <= BOUND_STEP ? goal : self.plus(toGoal.normalized().scale(BOUND_STEP));
    return coverWhere(
            situation,
            context,
            new CoverSearch(probe, threat, BOUND_SEARCH),
            feet ->
                (feet.horizontalDistance(goal) < remaining - 1.5 || remaining < 2)
                    && clearOfSpawn(situation, feet))
        .or(
            () ->
                coverWhere(
                    situation,
                    context,
                    new CoverSearch(self, threat, BOUND_REACH),
                    feet ->
                        feet.horizontalDistance(goal) < remaining - 1.5
                            && clearOfSpawn(situation, feet)));
  }

  /**
   * Whether {@code feet} is clear of the team's own spawn and its doorway: bounds never stop there,
   * so a team does not queue for the cover just outside its door.
   */
  private static boolean clearOfSpawn(Situation situation, Vec3 feet) {
    return situation
        .board()
        .plan()
        .home()
        .map(home -> home.horizontalDistance(feet) >= DOORWAY_CLEAR)
        .orElse(true);
  }

  // ---- safety ----------------------------------------------------------------------------------

  /** Cover that hides from the nearest enemy, else the own spawn, else where the bot stands. */
  private static CoverSpot safeSpot(Situation situation, TacticsContext context) {
    var self = situation.self();
    var threat = situation.nearestEnemy().map(Situation.KnownEnemy::pos);
    if (threat.isPresent()) {
      var away = self.pos().distance(threat.get()) - 1;
      var cover =
          coverWhere(
              situation,
              context,
              new CoverSearch(self.pos(), threat.get(), COVER_SEARCH),
              feet -> feet.distance(threat.get()) > away);
      if (cover.isPresent()) {
        return cover.orElseThrow();
      }
    }
    return new CoverSpot(-1, ownSpawn(situation, context).orElseGet(self::pos));
  }

  /** Away from the own bomb: towards the nearest armable bomb, else the enemy spawn. */
  private static Vec3 poisonExit(Situation situation, TacticsContext context) {
    var self = situation.self();
    var radius = situation.snapshot().poison().bombRadius() + POISON_MARGIN;
    var goal =
        situation
            .nearestArmableBomb()
            .map(bomb -> approach(context.nav(), bomb))
            .or(() -> enemySpawn(situation, context))
            .orElseGet(self::pos);
    var ownBomb = situation.nearestOwnBomb().map(BombView::pos);
    if (ownBomb.isEmpty() || goal.distance(ownBomb.get()) > radius) {
      return goal;
    }
    var away = goal.minus(ownBomb.get()).horizontal();
    var direction = away.isZero() ? new Vec3(1, 0, 0) : away.normalized();
    return ownBomb.get().plus(direction.scale(radius)).withY(self.pos().y());
  }

  private static Vec3 approach(NavArtifact nav, BombView bomb) {
    var node =
        nav.bombApproach(com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos.of(bomb.pos()));
    return node.isPresent() ? nav.graph().feet(node.getAsInt()) : bomb.pos();
  }

  private static Optional<Vec3> enemySpawn(Situation situation, TacticsContext context) {
    return spawnWhere(
        context.nav(), site -> !site.team().orElse("").equals(situation.self().team().value()));
  }

  private static Optional<Vec3> ownSpawn(Situation situation, TacticsContext context) {
    return spawnWhere(
        context.nav(), site -> site.team().orElse("").equals(situation.self().team().value()));
  }

  private static Optional<Vec3> spawnWhere(NavArtifact nav, Predicate<NavSites.Site> filter) {
    return nav.sites().spawns().stream()
        .filter(filter)
        .map(site -> nav.approachNode(site))
        .filter(node -> node.isPresent())
        .map(node -> nav.graph().feet(node.getAsInt()))
        .findFirst();
  }

  // ---- progress --------------------------------------------------------------------------------

  /** Whether {@code step} has achieved its purpose in {@code situation}. */
  public static boolean stepDone(PlanStep step, Situation situation, long startedTick) {
    var self = situation.self();
    return switch (step) {
      case PlanStep.Route(var goal, var _) -> reached(self.pos(), goal);
      case PlanStep.Fight(var target) ->
          situation.knownEnemies().stream().noneMatch(enemy -> enemy.id().equals(target));
      case PlanStep.Arm(var bomb) ->
          situation
              .snapshot()
              .bomb(bomb)
              .map(view -> !view.armableBy(self.team()) || view.state().isLit())
              .orElse(true);
      case PlanStep.Defuse(var bomb) ->
          situation.snapshot().bomb(bomb).map(view -> !view.state().isLit()).orElse(true);
      case PlanStep.Hold _ -> false;
      case PlanStep.Cover(var _, var pos, var _, var until) ->
          inCover(self.pos(), pos) && situation.now() >= until;
      case PlanStep.Heal _ -> self.effectiveHealth() >= Reflex.EAT_UNTIL;
      case PlanStep.Flee(var goal, var _) ->
          reached(self.pos(), goal)
              || situation
                  .nearestEnemy()
                  .map(enemy -> enemy.pos().distance(self.pos()) > FLEE_RANGE)
                  .orElse(true);
      case PlanStep.Ability _ -> situation.now() > startedTick;
    };
  }

  /** Whether a bot at {@code pos} stands in the cover at {@code cover}: in its block. */
  private static boolean inCover(Vec3 pos, Vec3 cover) {
    return pos.horizontalDistance(cover) <= COVER_REACHED && Math.abs(pos.y() - cover.y()) < 1.5;
  }

  private static boolean reached(Vec3 pos, Vec3 goal) {
    return pos.horizontalDistance(goal) <= ROUTE_REACHED && Math.abs(pos.y() - goal.y()) < 1.5;
  }

  // ---- decisions -------------------------------------------------------------------------------

  /** The decision carrying out the current step of {@code plan}. */
  public static Decision decide(
      Plan plan, Situation situation, TacticsContext context, int lifeEpoch) {
    var self = situation.self();
    var scene = new Scene(situation, context, lifeEpoch);
    var label = plan.option().name().toLowerCase(Locale.ROOT) + ":" + plan.current().label();
    var nextBomb =
        plan.upcoming(PlanStep.Arm.class)
            .map(PlanStep.Arm::bomb)
            .or(() -> plan.upcoming(PlanStep.Defuse.class).map(PlanStep.Defuse::bomb));
    var alongLane = plan.option() == Option.TAKE_SLOT || plan.option() == Option.ARM;
    return switch (plan.current()) {
      case PlanStep.Route(var goal, var stance) ->
          decision(
              situation,
              new Parts(
                  plan.option(),
                  stance == Stance.STEALTH
                      ? Optional.empty()
                      : holdTarget(situation, context, true),
                  pathTo(situation, context, goal, new Way(stance, alongLane)),
                  stance,
                  nextBomb,
                  Optional.empty(),
                  Optional.empty(),
                  label),
              lifeEpoch);
      case PlanStep.Fight(var target) -> fight(plan, scene, target);
      case PlanStep.Arm(var bomb) -> atBomb(plan, scene, bomb);
      case PlanStep.Defuse(var bomb) -> atBomb(plan, scene, bomb);
      case PlanStep.Hold(var pos, var watch, var stance) ->
          decision(
              situation,
              new Parts(
                  plan.option(),
                  holdTarget(situation, context, !reached(self.pos(), pos)),
                  reached(self.pos(), pos)
                      ? List.of()
                      : pathTo(situation, context, pos, new Way(stance, true)),
                  stance,
                  Optional.empty(),
                  Optional.of(watch),
                  Optional.empty(),
                  label),
              lifeEpoch);
      case PlanStep.Cover(var _, var pos, var watch, var _) ->
          decision(
              situation,
              new Parts(
                  plan.option(),
                  holdTarget(situation, context, !inCover(self.pos(), pos)),
                  inCover(self.pos(), pos)
                      ? List.of()
                      : pathTo(situation, context, pos, new Way(Stance.AGGRESSIVE, false)),
                  inCover(self.pos(), pos) ? Stance.CAUTIOUS : Stance.AGGRESSIVE,
                  Optional.empty(),
                  Optional.of(watch),
                  Optional.empty(),
                  label),
              lifeEpoch);
      case PlanStep.Heal(var cover, var _) ->
          decision(
              situation,
              new Parts(
                  plan.option(),
                  holdTarget(situation, context, true),
                  reached(self.pos(), cover)
                      ? List.of()
                      : pathTo(situation, context, cover, new Way(Stance.CAUTIOUS, false)),
                  Stance.CAUTIOUS,
                  Optional.empty(),
                  Optional.empty(),
                  Optional.empty(),
                  label),
              lifeEpoch);
      case PlanStep.Flee(var goal, var _) ->
          decision(
              situation,
              new Parts(
                  plan.option(),
                  Optional.empty(),
                  pathTo(situation, context, goal, new Way(Stance.EVASIVE, false)),
                  Stance.EVASIVE,
                  Optional.empty(),
                  Optional.empty(),
                  Optional.empty(),
                  label),
              lifeEpoch);
      case PlanStep.Ability(var name) ->
          decision(
              situation,
              new Parts(
                  plan.option(),
                  Optional.empty(),
                  List.of(),
                  Stance.EVASIVE,
                  Optional.empty(),
                  Optional.empty(),
                  Optional.of(name),
                  label),
              lifeEpoch);
    };
  }

  /**
   * Who to aim at while walking or holding: holding still, a bow takes any visible enemy inside its
   * band; on the move, or with a sword, only one close enough to swing at, so holding a slot never
   * turns into a charge and a bound is not frozen by a long shot.
   */
  static Optional<CombatantId> holdTarget(
      Situation situation, TacticsContext context, boolean moving) {
    var keep = context.keep();
    var reach = keep.ranged() && !moving ? keep.max() : CLOSE_FIGHT;
    return situation
        .percept()
        .nearestVisible()
        .filter(view -> view.pos().distance(situation.self().pos()) <= reach)
        .map(CombatantView::id);
  }

  /** The variable parts of a decision. */
  private record Parts(
      Option option,
      Optional<CombatantId> target,
      List<Waypoint> waypoints,
      Stance stance,
      Optional<BombId> bomb,
      Optional<Vec3> watch,
      Optional<String> ability,
      String label) {}

  private static Decision decision(Situation situation, Parts parts, int lifeEpoch) {
    return new Decision(
        situation.self().id(),
        parts.option(),
        parts.target(),
        parts.waypoints(),
        parts.stance(),
        parts.bomb(),
        parts.watch(),
        parts.ability(),
        parts.label(),
        situation.now(),
        lifeEpoch);
  }

  /** Who is deciding, with what, for which life. */
  private record Scene(Situation situation, TacticsContext context, int lifeEpoch) {}

  /**
   * Fights {@code target}: a sword closes in through the reflex layer; a bow holds its kit's band,
   * walking in when the enemy is beyond it and backing off when it is inside, and shoots only from
   * inside the band.
   */
  private static Decision fight(Plan plan, Scene scene, CombatantId target) {
    var situation = scene.situation();
    var context = scene.context();
    var known =
        situation.knownEnemies().stream().filter(enemy -> enemy.id().equals(target)).findFirst();
    var label = plan.option().name().toLowerCase(Locale.ROOT) + ":fight";
    if (known.isEmpty()) {
      return fightDecision(
          scene,
          plan,
          new Engagement(
              Optional.of(target), List.of(), Stance.AGGRESSIVE, Optional.empty(), label));
    }
    var enemy = known.orElseThrow();
    if (!enemy.visible() && context.keep().ranged()) {
      // An archer does not run at an enemy it cannot see: it takes up its band and waits.
      var archer = new Archer(situation, context, enemy.pos(), label);
      var wait =
          new Engagement(
              Optional.empty(),
              List.of(),
              Stance.CAUTIOUS,
              Optional.of(enemy.pos()),
              label + "-wait");
      return fightDecision(
          scene, plan, archer.close().or(archer::back).or(archer::support).orElse(wait));
    }
    if (!enemy.visible()) {
      return fightDecision(
          scene,
          plan,
          new Engagement(
              Optional.of(target),
              pathTo(situation, context, enemy.pos(), new Way(Stance.AGGRESSIVE, false)),
              Stance.AGGRESSIVE,
              Optional.of(enemy.pos()),
              label));
    }
    var shoot =
        new Engagement(
            Optional.of(target), List.of(), Stance.AGGRESSIVE, Optional.of(enemy.pos()), label);
    if (!context.keep().ranged()) {
      return fightDecision(scene, plan, shoot);
    }
    var archer = new Archer(situation, context, enemy.pos(), label);
    return fightDecision(
        scene,
        plan,
        archer
            .close()
            .or(archer::back)
            .or(archer::support)
            .or(archer::peek)
            .or(archer::room)
            .orElse(shoot));
  }

  /**
   * How an archer moves before it shoots: walks in when the enemy is beyond its band, backs off
   * when inside it, takes the edge of cover, or steps away from a teammate on its spot. Empty means
   * stand and shoot.
   */
  private record Archer(Situation situation, TacticsContext context, Vec3 enemy, String label) {

    Vec3 self() {
      return situation.self().pos();
    }

    double distance() {
      return enemy.distance(self());
    }

    Vec3 outward() {
      var away = self().minus(enemy).horizontal();
      return away.isZero() ? new Vec3(1, 0, 0) : away.normalized();
    }

    Engagement move(Vec3 to, Stance stance, String suffix) {
      return new Engagement(
          Optional.empty(),
          pathTo(situation, context, to, new Way(stance, false)),
          stance,
          Optional.of(enemy),
          label + suffix);
    }

    Optional<Engagement> close() {
      var keep = context.keep();
      if (distance() <= keep.max()) {
        return Optional.empty();
      }
      var closer =
          approachCover(situation, context, enemy)
              .map(CoverSpot::pos)
              .orElseGet(() -> enemy.plus(outward().scale(keep.max() - 2)));
      return Optional.of(move(closer, Stance.AGGRESSIVE, "-close"));
    }

    Optional<Engagement> back() {
      var keep = context.keep();
      var distance = distance();
      if (distance >= keep.min() || distance <= Reflex.BOW_MIN_RANGE) {
        return Optional.empty();
      }
      var back = self().plus(outward().scale(keep.min() - distance + 3));
      var cover =
          coverWhere(
                  situation,
                  context,
                  new CoverSearch(back, enemy, BOUND_SEARCH),
                  feet -> feet.distance(enemy) > distance)
              .map(CoverSpot::pos)
              .orElse(back);
      return Optional.of(move(cover, Stance.EVASIVE, "-back"));
    }

    Optional<Engagement> peek() {
      return peekSpot(situation, context, enemy)
          .filter(spot -> !inCover(self(), spot.pos()))
          .map(spot -> move(spot.pos(), Stance.AGGRESSIVE, "-peek"));
    }

    /** Reaches the team's firing position before settling into a local peek. */
    Optional<Engagement> support() {
      var keep = context.keep();
      return slotPoint(situation, context)
          .filter(goal -> goal.horizontalDistance(self()) > ROUTE_REACHED)
          .filter(goal -> goal.distance(enemy) >= keep.min() && goal.distance(enemy) <= keep.max())
          .map(
              goal ->
                  new Engagement(
                      Optional.empty(),
                      pathTo(situation, context, goal, new Way(Stance.AGGRESSIVE, true)),
                      Stance.AGGRESSIVE,
                      Optional.of(enemy),
                      label + "-support"))
          .filter(engagement -> !engagement.waypoints().isEmpty());
    }

    /** Two archers on one spot make one target: step sideways, away from the teammate. */
    Optional<Engagement> room() {
      return nearestAlly(situation)
          .filter(ally -> ally.distance(self()) < ARCHER_ROOM)
          .map(
              ally -> {
                var across = new Vec3(-outward().z(), 0, outward().x());
                var side =
                    across.dot(self().minus(ally).horizontal()) >= 0 ? across : across.scale(-1);
                return move(self().plus(side.scale(ARCHER_ROOM + 1)), Stance.CAUTIOUS, "-room");
              });
    }
  }

  /**
   * Where an archer shoots from: a cover point beside the bot that shields the directions either
   * side of the enemy but leaves the line to it open, the edge of a pillar or a wall end.
   */
  static Optional<CoverSpot> peekSpot(Situation situation, TacticsContext context, Vec3 enemy) {
    var nav = context.nav();
    var self = situation.self().pos();
    var me = situation.self().id();
    Optional<CoverSpot> best = Optional.empty();
    var bestDistance = Double.POSITIVE_INFINITY;
    for (var point : nav.cover().points()) {
      var feet = nav.graph().feet(point.node());
      var distance = feet.horizontalDistance(self);
      if (distance > PEEK_SEARCH || distance >= bestDistance) {
        continue;
      }
      var sector = CoverPoints.sectorOf(feet, enemy);
      var beside =
          point.protectsStanding((sector + 1) % CoverPoints.SECTORS)
              || point.protectsStanding((sector + CoverPoints.SECTORS - 1) % CoverPoints.SECTORS);
      var crowded =
          situation.livingAllies().stream()
              .anyMatch(ally -> ally.pos().horizontalDistance(feet) < COVER_ROOM);
      if (point.protectsStanding(sector)
          || !beside
          || crowded
          || situation.board().isCoverClaimed(point.node(), me)) {
        continue;
      }
      best = Optional.of(new CoverSpot(point.node(), feet));
      bestDistance = distance;
    }
    return best;
  }

  /** The peek spot an archer fighting {@code plan}'s target would claim, if it would. */
  static Optional<Integer> peekClaim(Plan plan, Situation situation, TacticsContext context) {
    if (!(plan.current() instanceof PlanStep.Fight(var target)) || !context.keep().ranged()) {
      return Optional.empty();
    }
    var keep = context.keep();
    return situation.knownEnemies().stream()
        .filter(enemy -> enemy.id().equals(target) && enemy.visible())
        .findFirst()
        .flatMap(
            enemy ->
                enemy.pos().distance(situation.self().pos()) <= keep.max()
                    ? peekSpot(situation, context, enemy.pos())
                    : approachCover(situation, context, enemy.pos()))
        .map(CoverSpot::node);
  }

  /** Cover inside an archer's band of {@code enemy}, near where the bot would close to. */
  private static Optional<CoverSpot> approachCover(
      Situation situation, TacticsContext context, Vec3 enemy) {
    var keep = context.keep();
    var self = situation.self().pos();
    var away = self.minus(enemy).horizontal();
    var outward = away.isZero() ? new Vec3(1, 0, 0) : away.normalized();
    var closer = enemy.plus(outward.scale(keep.max() - 2));
    return coverWhere(
        situation,
        context,
        new CoverSearch(closer, enemy, BOUND_SEARCH),
        feet -> feet.distance(enemy) <= keep.max() && feet.distance(enemy) >= keep.min());
  }

  private static Optional<Vec3> nearestAlly(Situation situation) {
    var self = situation.self().pos();
    return situation.livingAllies().stream()
        .map(CombatantView::pos)
        .min((a, b) -> Double.compare(a.distance(self), b.distance(self)));
  }

  /** How a fight is carried out this think. */
  private record Engagement(
      Optional<CombatantId> target,
      List<Waypoint> waypoints,
      Stance stance,
      Optional<Vec3> watch,
      String label) {}

  private static Decision fightDecision(Scene scene, Plan plan, Engagement engagement) {
    return decision(
        scene.situation(),
        new Parts(
            plan.option(),
            engagement.target(),
            engagement.waypoints(),
            engagement.stance(),
            Optional.empty(),
            engagement.watch(),
            Optional.empty(),
            engagement.label()),
        scene.lifeEpoch());
  }

  private static Decision atBomb(Plan plan, Scene scene, BombId bomb) {
    var situation = scene.situation();
    var context = scene.context();
    var lifeEpoch = scene.lifeEpoch();
    var view = situation.snapshot().bomb(bomb);
    var label = plan.option().name().toLowerCase(Locale.ROOT) + ":" + plan.current().label();
    var waypoints =
        view.filter(b -> b.pos().distance(situation.self().eye()) > Reflex.BOMB_REACH - 0.5)
            .map(
                b ->
                    pathTo(
                        situation,
                        context,
                        approach(context.nav(), b),
                        new Way(Stance.CAUTIOUS, false)))
            .orElseGet(List::of);
    return decision(
        situation,
        new Parts(
            plan.option(),
            holdTarget(situation, context, !waypoints.isEmpty()),
            waypoints,
            Stance.CAUTIOUS,
            Optional.of(bomb),
            view.map(BombView::pos),
            Optional.empty(),
            label),
        lifeEpoch);
  }

  /**
   * How a path is walked.
   *
   * @param stance how the bot moves; a last survivor's stealth avoids enemy sightlines
   * @param alongLane whether to keep to the corridor of the bot's slot lane
   */
  record Way(Stance stance, boolean alongLane) {}

  /** The waypoints from the bot to {@code goal}; empty when there is no path. */
  static List<Waypoint> pathTo(Situation situation, TacticsContext context, Vec3 goal, Way way) {
    var graph = context.nav().graph();
    var from = graph.nearestNode(situation.self().pos());
    var to = graph.nearestNode(goal);
    if (to.isEmpty()) {
      to = graph.nearestNodeWithin(goal, SNAP);
    }
    if (from.isEmpty() || to.isEmpty()) {
      return List.of();
    }
    Optional<Set<Integer>> corridor =
        way.alongLane()
            ? situation.slot().flatMap(situation.board().plan()::laneOf).map(Lane::corridor)
            : Optional.empty();
    IntToDoubleFunction extra =
        way.stance() == Stance.STEALTH ? stealthPenalty(situation, context) : node -> 0;
    var penalty =
        RoutePenalty.of(
            graph,
            context.seed(),
            new RoutePenalty.Tolls(
                situation.board().pathsOfOthers(situation.self().id()), corridor, extra));
    return graph
        .path(from.getAsInt(), to.getAsInt(), penalty)
        .map(found -> found.toFollow())
        .orElseGet(List::of);
  }

  private static IntToDoubleFunction stealthPenalty(Situation situation, TacticsContext context) {
    var nav = context.nav();
    var regions = nav.regions();
    Set<Integer> watchers = new HashSet<>();
    for (var enemy : situation.knownEnemies()) {
      nav.graph().nearestNode(enemy.pos()).ifPresent(node -> watchers.add(regions.regionOf(node)));
    }
    for (var site : nav.sites().spawns()) {
      if (!site.team().orElse("").equals(situation.self().team().value())) {
        nav.approachNode(site).ifPresent(node -> watchers.add(regions.regionOf(node)));
      }
    }
    return node -> STEALTH_PENALTY * regions.exposure(regions.regionOf(node), watchers);
  }

  /** Whether a bomb is still worth the plan it anchors. */
  static boolean bombStillRelevant(Optional<BombView> bomb) {
    return bomb.isPresent() && !(bomb.get().state() instanceof BombState.Destroyed);
  }
}
