package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.ApproachRoutes;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.map.TraversalCosts;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.random.RandomGenerator;

/**
 * The 1 to 2 Hz team step: forgets the dead, and every couple of seconds deals the playbook's slots
 * for the team's strategy and the match as it stands, a few of them turned to support the team's
 * human players ({@link HumanSupport}), then hands them to bots with the Hungarian algorithm over
 * fit, path distance and continuity, so a bot keeps its slot unless another is clearly better.
 */
public final class TeamBrain {

  /** How often slots are re-dealt, in ticks. */
  public static final int ROLE_PERIOD_TICKS = 40;

  /** The bonus for keeping the slot already held; a change must gain more than this. */
  public static final double STICKY = 0.3;

  /** How much travel time to a slot costs, per {@link #DISTANCE_SCALE} server ticks. */
  static final double DISTANCE_WEIGHT = 0.6;

  static final double DISTANCE_SCALE = TraversalCosts.walkingTicks(64);

  /** Distances past this count as this, so an unreachable slot is merely bad. */
  static final double DISTANCE_CAP = TraversalCosts.walkingTicks(128);

  /**
   * What a fuse worker's slot is worth less to a bot stuck in a fight ({@link Blackboard#pinned}):
   * more than the whole of a capped retake route, so the next bot takes it.
   */
  static final double HANDOFF = 6;

  /** The least gap, in ticks, between deals that hand a stuck worker's fuse on. */
  static final int HANDOFF_PERIOD_TICKS = 10;

  /** How much random preference an erratic (troll) bot adds to every slot. */
  static final double ERRATIC = 0.12;

  /** An enemy seen this close to a teammate holds the team's push, unless it is winning. */
  static final double CONTACT = 24;

  /**
   * A push held this long, in ticks, moves anyway: two even teams in contact the whole round would
   * otherwise never send the planter (prod: first plants at 210 s of 36 v 36).
   */
  public static final long STALL_TICKS = 200;

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

    /**
     * {@code team}'s living human players: its living members the team step deals no slot, as
     * nothing but a bot has a member record.
     */
    public List<CombatantView> humans(TeamId team) {
      return snapshot.alive(team).stream().filter(view -> !members.containsKey(view.id())).toList();
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
    var prepared = prepare(board, situation);
    var distances = new ArrayList<float[]>();
    if (prepared.distanceRows() > 0) {
      var workspace = situation.nav().graph().workspace();
      for (var row = 0; row < prepared.distanceRows(); row++) {
        distances.add(prepared.distances(row, workspace));
      }
    }
    return prepared.finish(distances, random);
  }

  /** Prepares immutable independent distance rows; no assignment randomness is consumed here. */
  public static Prepared prepare(Blackboard board, TeamSituation situation) {
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
    var urgent = RetakeFormation.urgent(snapshot, board.team()).map(BombView::id);
    var previousUrgent =
        result
            .plan()
            .objective()
            .flatMap(snapshot::bomb)
            .filter(bomb -> bomb.threatens(board.team()))
            .map(BombView::id);
    var defenseChanged = !urgent.equals(previousUrgent);
    var handOff =
        urgent.isPresent()
            && snapshot.tick() - result.rolesAssignedTick() >= HANDOFF_PERIOD_TICKS
            && stuckWorker(result, snapshot.tick());
    // A human who starts arming or meets an enemy is helped now, not at the next periodic deal.
    var supportChanged =
        urgent.isEmpty()
            && snapshot.tick() - result.rolesAssignedTick() >= HANDOFF_PERIOD_TICKS
            && HumanSupport.stale(result, situation, alive);
    if ((due || rosterChanged || defenseChanged || handOff || supportChanged) && !alive.isEmpty()) {
      return new Prepared(result, Optional.of(deal(result, situation, alive)), snapshot.tick());
    }
    return new Prepared(result, Optional.empty(), snapshot.tick());
  }

  /** Whether a bot holding a fuse worker's slot has been stuck in a fight too long to work it. */
  private static boolean stuckWorker(Blackboard board, long now) {
    var plan = board.plan();
    return plan.assignment().entrySet().stream()
        .anyMatch(
            entry ->
                plan.slot(entry.getValue()).map(slot -> slot.role() == Role.RETAKE).orElse(false)
                    && board.pinned(entry.getKey(), now));
  }

  /** The living bots stuck in a fight, whom fuse work passes over. */
  private static Set<CombatantId> pinned(Blackboard board, List<CombatantView> alive, long now) {
    var out = new HashSet<CombatantId>();
    alive.stream().map(CombatantView::id).filter(id -> board.pinned(id, now)).forEach(out::add);
    return out;
  }

  /** One prepared tick, completed only with its full ordered distance matrix. */
  public static final class Prepared {
    private final Blackboard board;
    private final Optional<Deal> deal;
    private final long tick;

    private Prepared(Blackboard board, Optional<Deal> deal, long tick) {
      this.board = board;
      this.deal = deal;
      this.tick = tick;
    }

    public int distanceRows() {
      return deal.map(value -> value.assignment().rows()).orElse(0);
    }

    public float[] distances(int row, NavGraph.SearchWorkspace workspace) {
      return deal.orElseThrow().assignment().distances(row, workspace);
    }

    /** Reuses staged geometric ETAs to shortlist workers without another graph search. */
    public List<CombatantId> workerCandidates(Slot worker, List<float[]> distances) {
      return deal.map(value -> value.assignment().workerCandidates(worker, distances))
          .orElseGet(List::of);
    }

    public Blackboard finish(List<float[]> distances, RandomGenerator random) {
      if (deal.isEmpty()) {
        if (!distances.isEmpty()) throw new IllegalArgumentException("unexpected role distances");
        return board;
      }
      var pending = deal.orElseThrow();
      var plan = pending.plan();
      var completed =
          new TeamPlan(
              plan.strategy(),
              plan.home(),
              plan.objective(),
              plan.lanes(),
              plan.push(),
              plan.slots(),
              pending.assignment().finish(distances, random),
              plan.dealtTick(),
              plan.groups(),
              plan.pushedTick());
      return board.withPlan(completed, tick);
    }
  }

  private record Deal(TeamPlan plan, RoleAssignment assignment) {}

  private static Deal deal(Blackboard board, TeamSituation situation, List<CombatantView> alive) {
    var nav = situation.nav();
    var snapshot = situation.snapshot();
    var team = board.team();
    var home = home(nav, team, alive);
    var defense = RetakeFormation.urgent(snapshot, team);
    if (defense.isPresent()) return retakeDeal(board, situation, alive, defense.orElseThrow());
    var held = heldNuke(board, snapshot, team);
    // A side well ahead arms the nuke it holds for itself; otherwise it guards it.
    var objective =
        held.filter(nuke -> nuke.armableBy(team) && ahead(snapshot, team))
            .or(() -> ObjectiveChoice.choose(board, situation, alive));
    var lanes = lanes(board, situation, home, objective);
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
    var odds = Odds.of(snapshot, team, sightingsNear(board, snapshot.tick(), alive));
    var push = push(board.plan(), alive, odds, snapshot.tick());
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
            watchers(nav, sightings, enemyHome),
            odds.closing(),
            field(nav, team),
            held);
    var humans = new java.util.HashMap<CombatantId, CombatantView>();
    situation.humans(team).forEach(human -> humans.put(human.id(), human));
    var slots =
        HumanSupport.adapt(
            Playbook.deal(setup), HumanSupport.calls(board, situation, alive, home), humans);
    var nuke = objective.map(bomb -> bomb.owner() instanceof BombOwner.Nuke).orElse(false);
    var assignment =
        new RoleAssignment(
            new Dealing(
                board.plan(), situation, alive, nuke, pinned(board, alive, snapshot.tick())),
            slots);
    return new Deal(
        new TeamPlan(
            Optional.of(board.strategy()),
            Optional.of(home),
            objective.map(BombView::id),
            lanes,
            push,
            slots,
            Map.of(),
            snapshot.tick(),
            Squads.deal(board.plan().groups(), alive, situation.members()),
            push == board.plan().push() && board.plan().pushedTick() >= 0
                ? board.plan().pushedTick()
                : snapshot.tick()),
        assignment);
  }

  private static Deal retakeDeal(
      Blackboard board, TeamSituation situation, List<CombatantView> alive, BombView bomb) {
    var slots = RetakeFormation.slots(situation.nav(), bomb, alive, board.plan());
    var pinned = pinned(board, alive, situation.snapshot().tick());
    var assignment =
        new RoleAssignment(new Dealing(board.plan(), situation, alive, false, pinned), slots);
    return new Deal(
        new TeamPlan(
            Optional.of(board.strategy()),
            board.plan().home(),
            Optional.of(bomb.id()),
            List.of(),
            board.plan().push(),
            slots,
            Map.of(),
            situation.snapshot().tick(),
            Squads.deal(board.plan().groups(), alive, situation.members()),
            board.plan().pushedTick()),
        assignment);
  }

  /**
   * How the fight stands for a team.
   *
   * @param ours the team's living members, bots or not
   * @param theirs every other team's living members
   * @param contact whether a teammate saw an enemy close by lately
   */
  record Odds(int ours, int theirs, boolean contact) {

    /** Who is alive in {@code snapshot}, seen from {@code team}. */
    static Odds of(WorldSnapshot snapshot, TeamId team, boolean contact) {
      return new Odds(snapshot.alive(team).size(), snapshot.aliveEnemiesOf(team).size(), contact);
    }

    /**
     * Whether the team is far enough ahead to close the round out: it outnumbers an enemy down to
     * its last two, or outnumbers the enemy two to one. An even fight is never rushed.
     */
    boolean closing() {
      return theirs > 0 && ((theirs <= 2 && ours > theirs) || ours >= 2 * theirs);
    }

    /** Whether the team leads by at least two and a quarter: a fight it can press. */
    boolean leading() {
      return ours >= theirs + 2 && ours * 4 >= theirs * 5;
    }
  }

  /**
   * How far the team has pushed up its lanes: {@link Playbook#START_PUSH} at the first deal, then
   * {@link Playbook#ADVANCE} more each deal up to {@link Playbook#MAX_PUSH} once the team formed up
   * on its last bound. In contact the team holds unless it leads the fight; any hold moves on after
   * {@link #STALL_TICKS}, so an even stalemate still sends the planter, a bound at a time. Closing
   * out the round goes all the way.
   */
  static double push(TeamPlan previous, List<CombatantView> alive, Odds odds, long now) {
    if (previous.dealtTick() < 0) {
      return Playbook.START_PUSH;
    }
    if (odds.closing()) {
      return Math.max(previous.push(), Playbook.MAX_PUSH);
    }
    var pressing = odds.contact() ? odds.leading() : formedUp(previous, alive);
    var stalled = previous.pushedTick() >= 0 && now - previous.pushedTick() >= STALL_TICKS;
    return pressing || stalled
        ? Math.min(Playbook.MAX_PUSH, previous.push() + Playbook.ADVANCE)
        : previous.push();
  }

  /** Advance the line only once most mobile squad members actually reach its previous bound. */
  private static boolean formedUp(TeamPlan previous, List<CombatantView> alive) {
    var byKey = new java.util.HashMap<String, Slot>();
    previous.slots().forEach(slot -> byKey.put(slot.key(), slot));
    var mobile = 0;
    var ready = 0;
    for (var bot : alive) {
      var key = previous.assignment().get(bot.id());
      var slot = key == null ? null : byKey.get(key);
      if (slot == null
          || slot.kind() == SlotKind.ANCHOR
          || slot.kind() == SlotKind.OVERWATCH
          || slot.kind() == SlotKind.ESCORT) continue;
      mobile++;
      if (bot.pos().horizontalDistance(slot.pos()) <= 6
          && Math.abs(bot.pos().y() - slot.pos().y()) <= 1.5) ready++;
    }
    return mobile == 0 || ready * 5 >= mobile * 3;
  }

  /** Whether a teammate saw an enemy lately within {@link #CONTACT} blocks of some teammate. */
  private static boolean sightingsNear(Blackboard board, long now, List<CombatantView> alive) {
    return board.visibleSightings(now).stream()
        .filter(sighting -> now - sighting.seenTick() <= ROLE_PERIOD_TICKS)
        .anyMatch(
            sighting ->
                alive.stream().anyMatch(bot -> bot.pos().distance(sighting.pos()) <= CONTACT));
  }

  /**
   * The team's lanes up the field: from home to the enemy's bomb, else to the enemy's home,
   * whatever the objective, so a team playing for the central nuke still spreads over the whole
   * yard. Built at the first deal and kept for the match.
   */
  private static List<Lane> lanes(
      Blackboard board, TeamSituation situation, Vec3 home, Optional<BombView> objective) {
    var nav = situation.nav();
    var snapshot = situation.snapshot();
    var team = board.team();
    var previous = board.plan();
    if (!previous.lanes().isEmpty() && previous.objective().equals(objective.map(BombView::id))) {
      return previous.lanes();
    }
    var enemyBomb =
        objective
            .filter(bomb -> bomb.owner() instanceof BombOwner.Team)
            .or(
                () ->
                    snapshot.bombs().stream()
                        .filter(
                            bomb -> bomb.owner() instanceof BombOwner.Team && !bomb.belongsTo(team))
                        .findFirst());
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

  /**
   * The nuke {@code team} holds, whose guard {@link Playbook#HOLD} keeps beside it: one not lit
   * that it just defused (its last deal was a retake of it) or that its guard still holds, and one
   * it has lit while the enemy is about ({@link #contested}) or down to its last few. The rules let
   * anyone arm an idle nuke (rwf {@code Bomb.click}), so a defuser that walked away handed it
   * straight back to the side that armed it, and an armer that walked away left its fuse to the
   * enemy. A guard on every lit nuke took a bot from the human it kept company
   * (HumanSupportPlayTest).
   */
  static Optional<BombView> heldNuke(Blackboard board, WorldSnapshot snapshot, TeamId team) {
    var previous = board.plan();
    return snapshot.bombs().stream()
        .filter(bomb -> bomb.owner() instanceof BombOwner.Nuke)
        .filter(bomb -> !(bomb.state() instanceof BombState.Destroyed))
        .filter(
            bomb -> {
              var idle = !bomb.state().isLit();
              var threatened =
                  contested(board, snapshot.tick(), bomb)
                      || snapshot.aliveEnemiesOf(team).size() <= LAST_FEW;
              return (idle && (retook(previous, bomb) || guarded(previous, bomb)))
                  || (litBy(bomb, team) && threatened);
            })
        .findFirst();
  }

  /**
   * Against an enemy down to this many a lit nuke is guarded whether anyone was seen near it or
   * not: a last survivor sneaks to it unseen (a local sunspire match: Red, two against one, armed
   * it and walked off, and the last Blue defused it behind them, seven times).
   */
  static final int LAST_FEW = 2;

  /** An enemy seen this close to an idle nuke its team holds may come to arm it. */
  static final double CONTESTED = 24;

  /** Whether a teammate saw an enemy within {@link #CONTESTED} of {@code nuke} lately. */
  private static boolean contested(Blackboard board, long now, BombView nuke) {
    return board.visibleSightings(now).stream()
        .filter(sighting -> now - sighting.seenTick() <= STALL_TICKS)
        .anyMatch(sighting -> sighting.pos().distance(nuke.pos()) <= CONTESTED);
  }

  /** Whether {@code team} armed {@code nuke} and its fuse burns. */
  private static boolean litBy(BombView nuke, TeamId team) {
    return nuke.owner() instanceof BombOwner.Nuke(var by)
        && by.filter(team::equals).isPresent()
        && nuke.state().isLit();
  }

  /** Whether {@code previous} was a retake of {@code bomb}: a retake deal has no lanes. */
  private static boolean retook(TeamPlan previous, BombView bomb) {
    return previous.lanes().isEmpty() && previous.objective().filter(bomb.id()::equals).isPresent();
  }

  private static boolean guarded(TeamPlan previous, BombView bomb) {
    return previous.slot(Playbook.HOLD).flatMap(Slot::bomb).filter(bomb.id()::equals).isPresent();
  }

  /**
   * Whether {@code team} leads the fight as {@link Odds#leading} has it, by two and a quarter: a
   * side merely one up sent to arm the nuke left the enemy's bomb alone (ObjectivePlayTest's first
   * plants came later).
   */
  private static boolean ahead(WorldSnapshot snapshot, TeamId team) {
    return Odds.of(snapshot, team, false).leading();
  }

  /**
   * How long the team's field is: the walking ticks of its shortest baked route from a spawn of its
   * own to an enemy team's bomb, or 0 on a map without one.
   */
  static double field(NavArtifact nav, TeamId team) {
    var sites = nav.sites();
    var shortest = Double.POSITIVE_INFINITY;
    for (var spawn : sites.spawns()) {
      if (!ownedBy(spawn, team)) continue;
      for (var bomb : sites.bombs()) {
        if (bomb.team().isEmpty() || ownedBy(bomb, team)) continue;
        for (var route : nav.routes().between(spawn.name(), bomb.name())) {
          shortest = Math.min(shortest, route.length());
        }
      }
    }
    return Double.isFinite(shortest) ? shortest : 0;
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
   * @param pinned bots stuck in a fight, whom a fuse worker's slot passes over
   */
  record Dealing(
      TeamPlan previous,
      TeamSituation situation,
      List<CombatantView> alive,
      boolean nuke,
      Set<CombatantId> pinned) {

    Dealing {
      pinned = Set.copyOf(pinned);
    }
  }

  static double profit(Dealing dealing, CombatantView bot, Slot slot, double distance) {
    var member = dealing.situation().memberOf(bot.id());
    var held = slot.key().equals(dealing.previous().assignment().get(bot.id()));
    return SlotFit.of(member, slot, dealing.nuke() && slot.kind() == SlotKind.PLANT)
        - DISTANCE_WEIGHT
            * Math.min(distance, DISTANCE_CAP)
            / DISTANCE_SCALE
            * (slot.role() == Role.RETAKE || slot.key().equals(Playbook.HOLD) ? 4 : 1)
        + (held ? STICKY : 0)
        - HumanSupport.cost(slot, bot, dealing.situation().snapshot())
        - (slot.role() == Role.RETAKE && dealing.pinned().contains(bot.id()) ? HANDOFF : 0);
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
