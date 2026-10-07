package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.ApproachRoutes;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.random.RandomGenerator;

/**
 * The 1 to 2 Hz team step: forgets the dead, and every couple of seconds deals the playbook's slots
 * for the team's strategy and the match as it stands, then hands them to bots with the Hungarian
 * algorithm over fit, path distance and continuity, so a bot keeps its slot unless another is
 * clearly better.
 */
public final class TeamBrain {

  /** How often slots are re-dealt, in ticks. */
  public static final int ROLE_PERIOD_TICKS = 40;

  /** The bonus for keeping the slot already held; a change must gain more than this. */
  public static final double STICKY = 0.3;

  /** How much path distance to a slot costs, per {@link #DISTANCE_SCALE} blocks. */
  static final double DISTANCE_WEIGHT = 0.6;

  static final double DISTANCE_SCALE = 64;

  /** Distances past this count as this, so an unreachable slot is merely bad. */
  static final double DISTANCE_CAP = 128;

  /** How much random preference an erratic (troll) bot adds to every slot. */
  static final double ERRATIC = 0.5;

  /** An enemy seen this close to a teammate stops the team's push. */
  static final double CONTACT = 24;

  /** Anchors keep this far from the bomb they hold when there is no poison. */
  static final double ANCHOR_MIN = 3;

  /** Extra room anchors leave beyond the poison radius once poison starts. */
  static final double POISON_ROOM = 2;

  private static final int MAX_SIGHTINGS = 3;

  private TeamBrain() {}

  /**
   * One team's living bots and who they are.
   *
   * @param nav the baked map
   * @param snapshot the world
   * @param bots the living bots on the team
   * @param members each bot's archetype, quirks, role weights and kit
   */
  public record TeamSituation(
      NavArtifact nav,
      WorldSnapshot snapshot,
      List<CombatantView> bots,
      Map<CombatantId, SlotFit.Member> members) {

    public TeamSituation {
      bots = List.copyOf(bots);
      members = Map.copyOf(members);
      for (var bot : bots) {
        if (!members.containsKey(bot.id())) {
          throw new IllegalArgumentException("no member record for " + bot.id());
        }
      }
    }

    /** The member record of {@code bot}, which must be on the team. */
    public SlotFit.Member memberOf(CombatantId bot) {
      var member = members.get(bot);
      if (member == null) {
        throw new IllegalArgumentException("no member record for " + bot);
      }
      return member;
    }
  }

  /** Advances {@code board} for {@code situation}; {@code random} feeds erratic preferences. */
  public static Blackboard tick(Blackboard board, TeamSituation situation, RandomGenerator random) {
    var snapshot = situation.snapshot();
    var result = board;
    for (var combatant : snapshot.combatants()) {
      if (!combatant.alive()) {
        result = result.forget(combatant.id());
      }
    }
    var alive = situation.bots().stream().filter(CombatantView::alive).toList();
    var living = new HashSet<CombatantId>();
    alive.forEach(bot -> living.add(bot.id()));
    result = result.dropNotes(id -> !living.contains(id));
    var due = snapshot.tick() - result.rolesAssignedTick() >= ROLE_PERIOD_TICKS;
    var rosterChanged = !result.plan().assignment().keySet().equals(living);
    if ((due || rosterChanged) && !alive.isEmpty()) {
      result = result.withPlan(deal(result, situation, alive, random), snapshot.tick());
    }
    return result;
  }

  private static TeamPlan deal(
      Blackboard board,
      TeamSituation situation,
      List<CombatantView> alive,
      RandomGenerator random) {
    var nav = situation.nav();
    var snapshot = situation.snapshot();
    var team = board.team();
    var home = home(nav, team, alive);
    var objective = objective(board.strategy(), snapshot, team);
    var lanes = lanes(board, nav, snapshot, home);
    if (lanes.isEmpty()) {
      objective = Optional.empty();
    }
    var planter =
        board
            .plan()
            .holderOf("plant-0")
            .flatMap(snapshot::combatant)
            .filter(CombatantView::alive)
            .map(CombatantView::pos)
            .orElse(home);
    var sightings =
        board.visibleSightings(snapshot.tick()).stream()
            .limit(MAX_SIGHTINGS)
            .map(SharedSighting::pos)
            .toList();
    var enemyHome = enemyHome(nav, team, home);
    var guard =
        snapshot.bombsOf(team).stream()
            .map(BombView::pos)
            .min((a, b) -> Double.compare(a.distance(home), b.distance(home)))
            .orElse(home);
    var poison = snapshot.poison();
    var clear = poison.active() ? poison.bombRadius() + POISON_ROOM : ANCHOR_MIN;
    var push = push(board.plan(), alive, sightingsNear(board, snapshot.tick(), alive));
    var setup =
        new Playbook.Setup(
            nav,
            board.strategy(),
            alive.size(),
            home,
            objective,
            lanes,
            planter,
            push,
            guard,
            clear,
            sightings,
            enemyHome,
            watchers(nav, sightings, enemyHome));
    var slots = Playbook.deal(setup);
    var nuke = objective.map(bomb -> bomb.owner() instanceof BombOwner.Nuke).orElse(false);
    var assignment = assign(new Dealing(board.plan(), situation, alive, nuke), slots, random);
    return new TeamPlan(
        Optional.of(board.strategy()),
        Optional.of(home),
        objective.map(BombView::id),
        lanes,
        push,
        slots,
        assignment,
        snapshot.tick());
  }

  /**
   * How far the team has pushed up its lanes: {@link Playbook#START_PUSH} at the first deal, then
   * {@link Playbook#ADVANCE} more each deal up to {@link Playbook#MAX_PUSH}, holding where it is
   * once the team is in contact.
   */
  static double push(TeamPlan previous, List<CombatantView> alive, boolean contact) {
    if (previous.dealtTick() < 0) {
      return Playbook.START_PUSH;
    }
    return contact
        ? previous.push()
        : Math.min(Playbook.MAX_PUSH, previous.push() + Playbook.ADVANCE);
  }

  /** Whether a teammate saw an enemy lately within {@link #CONTACT} blocks of some teammate. */
  private static boolean sightingsNear(Blackboard board, long now, List<CombatantView> alive) {
    return board.visibleSightings(now).stream()
        .filter(sighting -> now - sighting.seenTick() <= ROLE_PERIOD_TICKS)
        .anyMatch(
            sighting ->
                alive.stream().anyMatch(bot -> bot.pos().distance(sighting.pos()) <= CONTACT));
  }

  /** The bomb the strategy plays for: the first it prefers that can still be armed. */
  static Optional<BombView> objective(Strategy strategy, WorldSnapshot snapshot, TeamId team) {
    var open =
        snapshot.bombsArmableBy(team).stream().filter(bomb -> !bomb.state().isLit()).toList();
    var enemyBomb =
        open.stream().filter(bomb -> bomb.owner() instanceof BombOwner.Team).findFirst();
    var nuke = open.stream().filter(bomb -> bomb.owner() instanceof BombOwner.Nuke).findFirst();
    return switch (strategy) {
      case RUSH, SPLIT -> enemyBomb.or(() -> nuke);
      case TURTLE, HUNT -> nuke.or(() -> enemyBomb);
    };
  }

  /**
   * The team's lanes up the field: from home to the enemy's bomb, else to the enemy's home,
   * whatever the objective, so a team playing for the central nuke still spreads over the whole
   * yard. Built at the first deal and kept for the match.
   */
  private static List<Lane> lanes(
      Blackboard board, NavArtifact nav, WorldSnapshot snapshot, Vec3 home) {
    var team = board.team();
    var previous = board.plan();
    if (!previous.lanes().isEmpty()) {
      return previous.lanes();
    }
    var enemyBomb =
        snapshot.bombs().stream()
            .filter(bomb -> bomb.owner() instanceof BombOwner.Team && !bomb.belongsTo(team))
            .findFirst();
    var end = enemyBomb.map(BombView::pos).orElseGet(() -> enemyHome(nav, team, home));
    var site = nearestSite(nav.sites().bombs(), end);
    var spawn = nav.sites().spawns().stream().filter(s -> ownedBy(s, team)).findFirst();
    List<ApproachRoutes.Route> baked =
        site.isPresent() && spawn.isPresent()
            ? nav.routes().between(spawn.orElseThrow().name(), site.orElseThrow().name())
            : List.of();
    var approach = nav.graph().nearestNodeWithin(end.plus(0, -0.5, 0), 3);
    var goal = approach.isPresent() ? nav.graph().feet(approach.getAsInt()) : end;
    return Lanes.toward(nav.graph(), home, goal, enemyBomb.isPresent() ? baked : List.of());
  }

  private static Optional<NavSites.Site> nearestSite(List<NavSites.Site> sites, Vec3 pos) {
    return sites.stream()
        .min(
            (a, b) ->
                Double.compare(a.cell().center().distance(pos), b.cell().center().distance(pos)));
  }

  private static boolean ownedBy(NavSites.Site site, TeamId team) {
    return site.team().map(team.value()::equals).orElse(false);
  }

  /** The middle of the team's spawns, else of its living bots. */
  static Vec3 home(NavArtifact nav, TeamId team, List<CombatantView> alive) {
    var spawns =
        nav.sites().spawns().stream()
            .filter(site -> ownedBy(site, team))
            .map(site -> site.cell().feet())
            .toList();
    return centroid(spawns.isEmpty() ? alive.stream().map(CombatantView::pos).toList() : spawns);
  }

  /** The middle of the other teams' spawns, else home mirrored through the map's middle. */
  private static Vec3 enemyHome(NavArtifact nav, TeamId team, Vec3 home) {
    var spawns =
        nav.sites().spawns().stream()
            .filter(site -> site.team().isPresent() && !ownedBy(site, team))
            .map(site -> site.cell().feet())
            .toList();
    if (!spawns.isEmpty()) {
      return centroid(spawns);
    }
    var bounds = nav.graph().bounds();
    var middle =
        new Vec3(
            bounds.origin().x() + bounds.sizeX() / 2.0,
            home.y(),
            bounds.origin().z() + bounds.sizeZ() / 2.0);
    return middle.scale(2).minus(home).withY(home.y());
  }

  private static Vec3 centroid(List<Vec3> points) {
    var sum = Vec3.ZERO;
    for (var point : points) {
      sum = sum.plus(point);
    }
    return sum.scale(1.0 / points.size());
  }

  /** The nav regions the enemy is likely to watch from: their spawn and where they were seen. */
  private static Set<Integer> watchers(NavArtifact nav, List<Vec3> sightings, Vec3 enemyHome) {
    var out = new HashSet<Integer>();
    var points = new ArrayList<Vec3>(sightings);
    points.add(enemyHome);
    for (var point : points) {
      nav.graph()
          .nearestNodeWithin(point, 3)
          .ifPresent(node -> out.add(nav.regions().regionOf(node)));
    }
    return out;
  }

  /**
   * Who a deal is for.
   *
   * @param previous the plan before this deal, whose slots bots keep if they can
   * @param situation the team
   * @param alive its living bots
   * @param nuke whether the plant slot arms the nuke
   */
  record Dealing(
      TeamPlan previous, TeamSituation situation, List<CombatantView> alive, boolean nuke) {}

  /**
   * Hands one slot to every bot so the summed profit is largest: fit minus path distance, plus
   * {@link #STICKY} for the slot already held, plus noise for erratic bots.
   */
  static Map<CombatantId, String> assign(
      Dealing dealing, List<Slot> slots, RandomGenerator random) {
    var graph = dealing.situation().nav().graph();
    var bots = dealing.alive().stream().sorted((a, b) -> a.id().compareTo(b.id())).toList();
    var slotNodes = new int[slots.size()];
    for (var j = 0; j < slots.size(); j++) {
      slotNodes[j] = graph.nearestNodeWithin(slots.get(j).pos(), 3).orElse(-1);
    }
    var profit = new double[bots.size()][slots.size()];
    for (var i = 0; i < bots.size(); i++) {
      var bot = bots.get(i);
      var from = graph.nearestNodeWithin(bot.pos(), 2);
      var costs = from.isPresent() ? graph.costsFrom(from.getAsInt()) : new float[0];
      for (var j = 0; j < slots.size(); j++) {
        var node = slotNodes[j];
        var reachable = node >= 0 && costs.length > 0 && Float.isFinite(costs[node]);
        var distance =
            reachable ? costs[node] : bot.pos().horizontalDistance(slots.get(j).pos()) * 2;
        var erratic =
            dealing.situation().memberOf(bot.id()).archetype() == Archetype.TROLL
                ? ERRATIC * random.nextDouble()
                : 0;
        profit[i][j] = profit(dealing, bot, slots.get(j), distance) + erratic;
      }
    }
    var columns = Hungarian.maximize(profit);
    var result = new HashMap<CombatantId, String>();
    for (var i = 0; i < bots.size(); i++) {
      result.put(bots.get(i).id(), slots.get(columns[i]).key());
    }
    return result;
  }

  private static double profit(Dealing dealing, CombatantView bot, Slot slot, double distance) {
    var member = dealing.situation().memberOf(bot.id());
    var held = slot.key().equals(dealing.previous().assignment().get(bot.id()));
    return SlotFit.of(member, slot, dealing.nuke() && slot.kind() == SlotKind.PLANT)
        - DISTANCE_WEIGHT * Math.min(distance, DISTANCE_CAP) / DISTANCE_SCALE
        + (held ? STICKY : 0);
  }

  /**
   * The round's strategy for a team whose members average {@code aggression} and {@code patience}
   * (each 0..1): aggressive teams rush or hunt, patient ones turtle, and larger teams split more.
   */
  public static Strategy chooseStrategy(
      double aggression, double patience, int teamSize, RandomGenerator random) {
    var weights = new EnumMap<Strategy, Double>(Strategy.class);
    weights.put(Strategy.RUSH, 0.2 + aggression);
    weights.put(Strategy.SPLIT, teamSize >= 3 ? 0.6 : 0.1);
    weights.put(Strategy.HUNT, 0.1 + aggression * 0.5);
    // A team that sits at home is dull to watch and to play against: at most one in four.
    var others = weights.values().stream().mapToDouble(Double::doubleValue).sum();
    weights.put(Strategy.TURTLE, Math.min(0.1 + 0.4 * patience, others / 3));
    var total = weights.values().stream().mapToDouble(Double::doubleValue).sum();
    var draw = random.nextDouble() * total;
    for (var entry : weights.entrySet()) {
      draw -= entry.getValue();
      if (draw < 0) {
        return entry.getKey();
      }
    }
    return Strategy.HUNT;
  }
}
