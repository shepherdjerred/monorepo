package com.shepherdjerred.thestorm.rwfbots.sim;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Perception;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.SenseContext;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.record.TraceHash;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Loadout;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexContext;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Situation;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Tactics;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.TacticsContext;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SharedSighting;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotFit;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamBrain;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stimulus;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.function.Predicate;

/**
 * A tiny headless Search and Destroy: builds a {@link WorldSnapshot} each tick, runs every bot's
 * perception, think and reflex steps, applies the body commands with block-collision movement, old
 * combat rules (iron sword, 1.8 armor, 18-tick hit delay) and the bomb rules, and hashes every
 * decision so two runs with one seed can be compared.
 */
final class SimWorld {

  static final double WALK_SPEED = 0.2158;
  static final double SPRINT_SPEED = 0.2806;
  static final int HIT_DELAY_TICKS = 18;
  static final double SWORD_DAMAGE = 6;
  static final int THINK_PERIOD = 8;
  static final int TEAM_PERIOD = 20;

  /** Where a combatant enters the match. */
  record Spawn(int id, TeamId team, Kit kit, Vec3 pos) {}

  final NavArtifact nav;
  final long seed;
  final SplittableRandom random;
  final Map<CombatantId, SimBody> bodies = new LinkedHashMap<>();
  final Map<BombId, SimBomb> bombs = new LinkedHashMap<>();
  final Map<TeamId, Blackboard> boards = new HashMap<>();
  final Map<TeamId, Strategy> strategies = new HashMap<>();
  long tick;
  long poisonStart = -1;
  TraceHash hash = TraceHash.EMPTY;
  private List<Stimulus> stimuli = new ArrayList<>();

  SimWorld(NavArtifact nav, long seed) {
    this.nav = nav;
    this.seed = seed;
    this.random = new SplittableRandom(seed);
  }

  SimBody addBot(Spawn spawn, double skill) {
    return addBot(spawn, LeverCurves.at(skill), new Style(0.5, 0.5, 0.6, 0.5));
  }

  SimBody addBot(Spawn spawn, Levers levers, Style style) {
    return addBot(spawn, new Persona(levers, style, Archetype.TACTICIAN, Set.of()));
  }

  /**
   * Who a bot is.
   *
   * @param levers how well it plays
   * @param style how it likes to play
   * @param archetype what kind of player it is
   * @param quirks its habits
   */
  record Persona(Levers levers, Style style, Archetype archetype, Set<Quirk> quirks) {}

  /** A bot playing as {@code persona}. */
  SimBody addBot(Spawn spawn, Persona persona) {
    var levers = persona.levers();
    var style = persona.style();
    var archetype = persona.archetype();
    var quirks = persona.quirks();
    var body = new SimBody(spawn);
    body.bot = true;
    body.levers = levers;
    body.style = style;
    body.archetype = archetype;
    body.quirks = Set.copyOf(quirks);
    body.perceiver =
        new Perception(new SenseContext(nav.grid(), nav.graph(), nav.regions(), body.levers));
    body.reflexContext =
        new ReflexContext(
            nav.grid(),
            body.levers,
            Loadout.standard(spawn.kit()),
            ReflexContext.Habits.of(archetype, quirks));
    body.tacticsContext =
        new TacticsContext(
            nav,
            body.levers,
            body.style,
            spawn.kit(),
            archetype,
            quirks,
            seed ^ (spawn.id() * 0x9E3779B97F4A7C15L));
    bodies.put(body.id, body);
    return body;
  }

  /** A combatant with no brain that stands where put until the scenario moves it. */
  SimBody addScripted(Spawn spawn) {
    var body = new SimBody(spawn);
    body.disguised = spawn.kit().isDisguiseKit();
    bodies.put(body.id, body);
    return body;
  }

  SimBomb addBomb(int id, TeamId owner, BlockPos cell) {
    var bomb = new SimBomb(new BombId(id), new BombOwner.Team(owner), cell.center());
    bombs.put(bomb.id, bomb);
    return bomb;
  }

  /** A nuke nobody owns at {@code cell}. */
  SimBomb addNuke(int id, BlockPos cell) {
    var bomb = new SimBomb(new BombId(id), new BombOwner.Nuke(), cell.center());
    bombs.put(bomb.id, bomb);
    return bomb;
  }

  void setStrategy(TeamId team, Strategy strategy) {
    strategies.put(team, strategy);
  }

  void startPoisonAt(long startTick) {
    poisonStart = startTick;
  }

  SimBody body(int id) {
    return bodies.get(new CombatantId(id));
  }

  SimBomb bomb(int id) {
    return bombs.get(new BombId(id));
  }

  /** Steps until {@code until} holds or {@code maxTicks} pass; returns the ticks run. */
  int run(int maxTicks, Predicate<SimWorld> until) {
    for (var i = 0; i < maxTicks; i++) {
      if (until.test(this)) {
        return i;
      }
      step();
    }
    return maxTicks;
  }

  Optional<TeamId> winner() {
    var alive = new ArrayList<TeamId>();
    for (var body : bodies.values()) {
      if (body.alive && !alive.contains(body.team)) {
        alive.add(body.team);
      }
    }
    return alive.size() == 1 ? Optional.of(alive.getFirst()) : Optional.empty();
  }

  /** A scripted attacker lands a hit on {@code victim}, as a Spy revealing itself would. */
  void scriptedHit(int attacker, int victim) {
    damage(bodies.get(new CombatantId(attacker)), bodies.get(new CombatantId(victim)));
  }

  void step() {
    tick++;
    var snapshot = snapshot();
    stimuli = new ArrayList<>();
    for (var body : bodies.values()) {
      body.previousPos = body.pos;
    }
    teams(snapshot);
    for (var body : bodies.values()) {
      if (body.bot && body.alive) {
        brain(body, snapshot);
      }
    }
    for (var body : bodies.values()) {
      if (body.alive) {
        move(body);
      }
    }
    tickBombs();
    poison();
  }

  private void tickBombs() {
    for (var bomb : bombs.values()) {
      var before = bomb.exploded();
      bomb.tick(tick);
      if (!before && bomb.exploded()) {
        killOwners(bomb);
      }
    }
  }

  private void killOwners(SimBomb bomb) {
    for (var body : bodies.values()) {
      if (bomb.owner.isTeam(body.team)) {
        body.hurt(1000, tick);
      }
    }
  }

  private WorldSnapshot snapshot() {
    var poison =
        poisonStart >= 0 && tick >= poisonStart
            ? PoisonView.startedAt(poisonStart, (tick - poisonStart) / 1200.0)
            : PoisonView.NONE;
    return new WorldSnapshot(
        tick,
        MatchPhase.LIVE,
        bodies.values().stream().map(body -> body.view(tick)).toList(),
        bombs.values().stream().map(SimBomb::view).toList(),
        poison,
        nav.mapId(),
        stimuli);
  }

  private void teams(WorldSnapshot snapshot) {
    for (var team : bodies.values().stream().map(body -> body.team).distinct().toList()) {
      var board =
          boards.computeIfAbsent(
              team, t -> Blackboard.open(t, strategies.getOrDefault(t, Strategy.RUSH)));
      var bots =
          bodies.values().stream().filter(b -> b.bot && b.team.equals(team) && b.alive).toList();
      var assigned = board.plan().assignment();
      var unassigned = bots.stream().anyMatch(b -> !assigned.containsKey(b.id));
      if ((tick % TEAM_PERIOD == 1 || unassigned) && !bots.isEmpty()) {
        var members = new HashMap<CombatantId, SlotFit.Member>();
        for (var bot : bots) {
          members.put(
              bot.id,
              new SlotFit.Member(
                  bot.archetype,
                  bot.quirks,
                  bot.roleWeights,
                  bot.kit,
                  bot.tacticsContext.remainingStartTicks(bot.tactics, snapshot.tick())));
        }
        var views = bots.stream().map(b -> b.view(tick)).toList();
        board =
            TeamBrain.tick(
                board, new TeamBrain.TeamSituation(nav, snapshot, views, members), random);
      }
      boards.put(team, board);
    }
  }

  private void brain(SimBody body, WorldSnapshot snapshot) {
    var self = snapshot.require(body.id);
    var percept = body.perceiver.perceive(body.perception, self, snapshot, random);
    body.perception = percept.state();
    body.seesEnemy = !percept.visible().isEmpty();
    body.nearestSeen =
        percept.nearestVisible().map(view -> view.pos().distance(self.pos())).orElse(-1.0);
    share(body, percept);
    var board = boards.get(body.team);
    var role = board.roleOf(body.id).orElseThrow();
    if (body.decision.isEmpty() || (tick + body.id.value()) % THINK_PERIOD == 0) {
      var situation = new Situation(self, snapshot, percept, board, role);
      var thought = Tactics.think(body.tactics, situation, body.tacticsContext, random);
      boards.put(body.team, board.note(body.id, thought.note()));
      body.tactics = thought.state();
      body.decision = Optional.of(thought.decision());
      body.decisions.add(thought.decision());
      hash = hash.add(thought.trace()).add(thought.decision());
    }
    var input =
        ReflexInput.of(self, snapshot, body.decision.orElseThrow(), percept)
            .withGapples(body.gapples);
    var step = Reflex.tick(body.reflex, input, body.reflexContext, random);
    body.reflex = step.state();
    body.lastCommands.clear();
    body.lastCommands.addAll(step.commands());
    for (var command : step.commands()) {
      apply(body, command);
    }
  }

  private void share(SimBody body, Percept percept) {
    if (percept.visible().isEmpty()) {
      return;
    }
    var reports = new ArrayList<SharedSighting>();
    for (var seen : percept.visible()) {
      reports.add(new SharedSighting(seen.id(), seen.pos(), seen.vel(), tick, tick, body.id));
    }
    var board = boards.get(body.team);
    boards.put(body.team, board.share(reports, body.levers.coordination(), tick, random));
  }

  private void apply(SimBody body, BodyCommand command) {
    switch (command) {
      case BodyCommand.Look(var yaw, var pitch) -> body.look = new Facing(yaw, pitch);
      case BodyCommand.MoveToward(var waypoint, var sprint) -> {
        body.moveTarget = Optional.of(waypoint);
        body.sprinting = sprint;
      }
      case BodyCommand.Stop _ -> {
        body.moveTarget = Optional.empty();
        body.sprinting = false;
      }
      case BodyCommand.Jump _ -> body.jumpTick = tick;
      case BodyCommand.Sneak _ -> {}
      case BodyCommand.SelectSlot(var slot) -> body.heldSlot = slot;
      case BodyCommand.Swing _ -> {}
      case BodyCommand.Attack(var target) -> attack(body, target);
      case BodyCommand.StartUse _ -> {
        body.usingItem = true;
        body.useStart = tick;
      }
      case BodyCommand.ReleaseUse _ -> release(body);
      case BodyCommand.CancelUse _ -> {
        body.usingItem = false;
        body.useStart = -1;
      }
      case BodyCommand.ClickBomb(var bombId) -> clickBomb(body, bombId);
      case BodyCommand.UseAbility _ -> {}
    }
  }

  private void attack(SimBody attacker, CombatantId targetId) {
    var target = bodies.get(targetId);
    if (target == null || !target.alive) {
      return;
    }
    attacker.attacksOn.merge(targetId, 1, Integer::sum);
    var hits = Reflex.hitTest(nav.grid(), attacker.view(tick), attacker.look, target.view(tick));
    if (!hits || (target.lastHurt >= 0 && tick - target.lastHurt < HIT_DELAY_TICKS)) {
      return;
    }
    damage(attacker, target);
  }

  private void damage(SimBody attacker, SimBody target) {
    var dealt = SWORD_DAMAGE * (1 - target.armor / 25.0);
    target.hurt(dealt, tick);
    stimuli.add(Stimulus.hit(target.pos, tick, attacker.id, target.id));
    var push = target.pos.minus(attacker.pos).horizontal();
    if (!push.isZero()) {
      var pushed = target.pos.plus(push.normalized().scale(0.5));
      if (passable(pushed)) {
        target.pos = pushed;
      }
    }
  }

  private void release(SimBody body) {
    var loadout = body.reflexContext == null ? null : body.reflexContext.loadout();
    var eating = loadout != null && body.heldSlot == loadout.gappleSlot() && body.gapples > 0;
    if (body.usingItem && eating && tick - body.useStart >= Reflex.EAT_TICKS) {
      body.health = Math.min(20, body.health + 4);
      body.absorption = 4;
      body.gapples--;
      stimuli.add(Stimulus.by(Stimulus.Kind.EAT, body.pos, tick, body.id));
    }
    body.usingItem = false;
    body.useStart = -1;
  }

  private void clickBomb(SimBody body, BombId bombId) {
    var bomb = bombs.get(bombId);
    if (bomb == null || bomb.pos.distance(body.pos.plus(0, CombatantView.EYE_HEIGHT, 0)) > 3.5) {
      return;
    }
    var lastAlive =
        bodies.values().stream().noneMatch(b -> b.alive && b.team.equals(body.team) && b != body);
    bomb.click(body.id, body.team, tick, lastAlive);
    stimuli.add(Stimulus.by(Stimulus.Kind.FUSE_CLICK, bomb.pos, tick, body.id));
  }

  private void move(SimBody body) {
    if (body.moveTarget.isEmpty()) {
      return;
    }
    var target = body.moveTarget.get();
    var delta = target.minus(body.pos).horizontal();
    if (delta.isZero()) {
      return;
    }
    var speed = body.sprinting ? SPRINT_SPEED : WALK_SPEED;
    var step = delta.length() <= speed ? delta : delta.normalized().scale(speed);
    var next = body.pos.plus(step);
    var stepUp = target.y() > body.pos.y() + 0.5 && tick - body.jumpTick <= 6;
    if (fits(next)) {
      body.pos = next;
    } else if (stepUp && fits(next.plus(0, 1, 0))) {
      body.pos = next.plus(0, 1, 0);
    } else if (fits(body.pos.plus(step.x(), 0, 0))) {
      body.pos = body.pos.plus(step.x(), 0, 0);
    } else if (fits(body.pos.plus(0, 0, step.z()))) {
      body.pos = body.pos.plus(0, 0, step.z());
    }
    settle(body);
    if (body.sprinting && tick % 10 == 0) {
      stimuli.add(Stimulus.by(Stimulus.Kind.FOOTSTEP, body.pos, tick, body.id));
    }
  }

  private void settle(SimBody body) {
    var below = BlockPos.of(body.pos).down();
    var grid = nav.grid();
    if (!grid.blocksMovement(below) && body.pos.y() > 1) {
      body.pos = body.pos.plus(0, -1, 0);
    }
    body.onGround = grid.blocksMovement(BlockPos.of(body.pos).down());
  }

  private boolean fits(Vec3 feet) {
    return passable(feet) && passable(feet.plus(0, 1, 0));
  }

  private boolean passable(Vec3 point) {
    return !nav.grid().blocks(BlockPos.of(point), VoxelGrid.Layer.MOVEMENT);
  }

  private void poison() {
    if (poisonStart < 0 || tick < poisonStart) {
      return;
    }
    for (var body : bodies.values()) {
      if (!body.alive) {
        continue;
      }
      var nearOwnBomb =
          bombs.values().stream()
              .anyMatch(bomb -> bomb.owner.isTeam(body.team) && bomb.pos.distance(body.pos) <= 15);
      if (nearOwnBomb && tick % 20 == 0) {
        body.hurt(1, tick);
      } else if (tick % 200 == 0) {
        body.hurt(1, tick);
      }
    }
  }
}
