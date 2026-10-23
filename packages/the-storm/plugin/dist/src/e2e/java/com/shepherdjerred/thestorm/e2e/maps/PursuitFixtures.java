package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.rwfbots.adapter.citizens.CitizensBodies;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.PersonalityFiles;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.SnapshotCapture;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Memory;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Sighting;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Suspicion;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Loadout;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexContext;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexState;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Plan;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.PlanStep;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Planner;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Situation;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.TacticsContext;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.event.HandlerList;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;
import tools.jackson.databind.json.JsonMapper;

/** Production planner/reflex/motor traversal proof; attack commands are observed, never applied. */
public final class PursuitFixtures implements BasicCommand, AutoCloseable {
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private static final Wire WIRE = Wire.load();
  private static final TeamId RED = new TeamId("red");
  private static final TeamId BLUE = new TeamId("blue");
  private static final GridBounds BOUNDS = new GridBounds(new BlockPos(300, 99, 300), 16, 7, 12);
  private final JavaPlugin plugin;
  private final World world;
  private final SnapshotCapture capture;
  private Optional<Vec3> previousPosition = Optional.empty();
  private final List<Observation> observations = new ArrayList<>();
  private final SplittableRandom random = new SplittableRandom(196);
  private Optional<CitizensBodies> bodies = Optional.empty();
  private Optional<UUID> attacker = Optional.empty();
  private Optional<BukkitTask> clock = Optional.empty();
  private Optional<NavArtifact> nav = Optional.empty();
  private ReflexState reflex = ReflexState.initial(new Facing(-90, 0));
  private Memory memory = Memory.EMPTY;
  private Optional<Decision> decision = Optional.empty();
  private String state = "idle";
  private int ticks;
  private boolean routed;
  private boolean doorway;
  private int swings;
  private int attacks;

  private record Observation(
      int tick, List<Double> position, boolean visible, int waypoints, int index) {}

  private record Status(
      String state,
      int ticks,
      boolean routed,
      boolean doorway,
      int swings,
      int attacks,
      List<Observation> observations) {}

  private record Wire(
      int version,
      List<String> states,
      List<String> status,
      List<String> observation,
      List<String> position) {
    static Wire load() {
      try (var stream = PursuitFixtures.class.getResourceAsStream("/rwf-pursuit.json")) {
        if (stream == null) throw new IllegalStateException("pursuit wire contract missing");
        var wire = JSON.readValue(stream, Wire.class);
        if (wire.version() != 1
            || !wire.states().equals(List.of("idle", "prepared", "running", "passed", "failed"))
            || !wire.status().equals(components(Status.class))
            || !wire.observation().equals(components(Observation.class))
            || !wire.position().equals(List.of("x", "y", "z"))) {
          throw new IllegalStateException("pursuit wire contract differs from producer");
        }
        return wire;
      } catch (IOException failure) {
        throw new IllegalStateException("pursuit wire contract unreadable", failure);
      }
    }

    private static List<String> components(Class<?> record) {
      return Arrays.stream(record.getRecordComponents())
          .map(java.lang.reflect.RecordComponent::getName)
          .toList();
    }
  }

  public PursuitFixtures(JavaPlugin plugin, World world) {
    this.plugin = plugin;
    this.world = world;
    var time = java.time.InstantSource.fixed(java.time.Instant.EPOCH);
    this.capture =
        new SnapshotCapture(
            new com.shepherdjerred.thestorm.rwfbots.adapter.paper.IdMap(),
            id -> Optional.empty(),
            new SnapshotCapture.Sources(
                new com.shepherdjerred.thestorm.rwfbots.adapter.paper.StimulusCollector(
                    new com.shepherdjerred.thestorm.rwf.app.BattleSoundLog(time), time),
                java.util.List::of),
            new SnapshotCapture.Capabilities(id -> Optional.empty(), time));
  }

  public void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> event.registrar().register("storm-fixture-pursuit", this));
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (!(source.getSender() instanceof ConsoleCommandSender)
        && !(source.getSender() instanceof RemoteConsoleCommandSender)) {
      throw new IllegalArgumentException("pursuit proof requires the disposable console");
    }
    if (args.length == 1 && args[0].equals("prepare")) prepare();
    else if (args.length == 1 && args[0].equals("start")) start();
    else if (args.length != 1 || !args[0].equals("status")) {
      throw new IllegalArgumentException("use prepare, start or status");
    }
    if (!WIRE.states().contains(state)) throw new IllegalStateException("unknown pursuit state");
    source
        .getSender()
        .sendMessage(
            Component.text(
                JSON.writeValueAsString(
                    new Status(state, ticks, routed, doorway, swings, attacks, observations))));
  }

  private void prepare() {
    if (!state.equals("idle")) throw new IllegalStateException("pursuit proof is single-use");
    var arena = new Arena();
    placeArena(arena);
    nav = Optional.of(MapBaker.bake("pursuit-proof", arena, new NavSites(List.of(), List.of())));
    var catalog =
        PersonalityFiles.load(plugin.getDataFolder().toPath().getParent().resolve("TheStorm"));
    var personality =
        catalog.active().stream()
            .sorted(java.util.Comparator.comparing(p -> p.id()))
            .findFirst()
            .orElseThrow();
    var owner =
        CitizensBodies.open(
            plugin,
            id -> {},
            new SnapshotCapture.Capabilities(
                id -> Optional.empty(), java.time.InstantSource.fixed(java.time.Instant.EPOCH)));
    bodies = Optional.of(owner);
    var id = owner.create(personality);
    attacker = Optional.of(id);
    owner.spawn(id, new Location(world, 306.5, 100, 308.5, -90, 0));
    var targetPersonality =
        catalog.active().stream()
            .sorted(java.util.Comparator.comparing(p -> p.id()))
            .skip(1)
            .findFirst()
            .orElseThrow();
    var targetBody = owner.create(targetPersonality);
    owner.spawn(targetBody, new Location(world, 308.5, 100, 308.5, 90, 0));
    state = "prepared";
  }

  private void placeArena(Arena arena) {
    for (int x = 300; x < 316; x++)
      for (int z = 300; z < 312; z++) {
        world.addPluginChunkTicket(x >> 4, z >> 4, plugin);
        for (int y = 99; y < 106; y++) {
          world.getBlockAt(x, y, z).setType(material(arena.shape(x, y, z)), false);
        }
      }
  }

  private static Material material(BlockShape shape) {
    if (shape == BlockShape.FULL) return Material.STONE;
    if (shape == BlockShape.PANE) return Material.GLASS;
    if (shape == BlockShape.PASSABLE) return Material.AIR;
    throw new IllegalArgumentException("unsupported pursuit arena shape " + shape);
  }

  private void start() {
    if (!state.equals("prepared"))
      throw new IllegalStateException("prepare the pursuit proof first");
    state = "running";
    clock = Optional.of(plugin.getServer().getScheduler().runTaskTimer(plugin, this::tick, 1, 1));
  }

  private void tick() {
    ticks++;
    if (ticks > 20)
      bodies
          .orElseThrow()
          .entity(attacker.orElseThrow())
          .ifPresent(player -> advance(self(player)));
    if (state.equals("running") && ticks >= 600) finish(false);
  }

  private CombatantView self(org.bukkit.entity.Player player) {
    var at = player.getLocation();
    var point = new Vec3(at.getX(), at.getY(), at.getZ());
    var velocity = previousPosition.map(point::minus).orElse(Vec3.ZERO);
    previousPosition = Optional.of(point);
    return new CombatantView(
        new CombatantId(1),
        RED,
        false,
        Kit.TROOPER,
        !player.isDead(),
        point,
        velocity,
        at.getYaw(),
        at.getPitch(),
        player.getHealth(),
        player.getAbsorptionAmount(),
        0,
        player.getInventory().getHeldItemSlot(),
        player.isSprinting(),
        SnapshotCapture.onGround(player),
        player.isHandRaised(),
        false,
        -1,
        capture.captureTraversal(player, "trooper", ticks),
        com.shepherdjerred.thestorm.rwfbots.domain.world.Quiver.ENDLESS);
  }

  private void advance(CombatantView self) {
    var artifact = nav.orElseThrow();
    var enemy =
        view(2, BLUE, new Pose(new Vec3(308.5, 100, 308.5), Vec3.ZERO, new Facing(90, 0), true));
    var visible = artifact.grid().canSee(self.eye(), enemy.eye());
    if (visible)
      memory = memory.remember(enemy.id(), new Sighting(enemy.pos(), enemy.vel(), ticks, 1, true));
    var percept =
        new Percept(
            new PerceptionState(memory, Suspicion.NONE),
            visible ? List.of(enemy) : List.of(),
            ticks);
    var snapshot =
        new WorldSnapshot(
            ticks,
            MatchPhase.LIVE,
            List.of(self, enemy),
            List.of(),
            PoisonView.NONE,
            artifact.mapId(),
            List.of(),
            List.of(),
            List.of());
    var situation =
        new Situation(self, snapshot, percept, Blackboard.open(RED, Strategy.HUNT), Role.HUNT);
    var levers = LeverCurves.at(1);
    var context =
        new TacticsContext(
            artifact,
            levers,
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.DUELIST,
            Set.of(),
            196,
            null);
    if (decision.isEmpty() || ticks % 5 == 0) {
      decision =
          Optional.of(
              Planner.decide(
                  Plan.of(Option.ENGAGE, ticks, new PlanStep.Fight(enemy.id())),
                  situation,
                  context,
                  0));
    }
    var standing = decision.orElseThrow();
    routed |= !standing.waypoints().isEmpty();
    var step =
        Reflex.tick(
            reflex,
            ReflexInput.of(self, snapshot, standing, percept),
            new ReflexContext(artifact.grid(), levers, Loadout.standard(Kit.TROOPER)),
            random);
    reflex = step.state();
    doorway |= self.pos().x() >= 307 && self.pos().x() < 308 && self.pos().z() < 305;
    if (ticks % 5 == 0)
      observations.add(
          new Observation(
              ticks,
              List.of(self.pos().x(), self.pos().y(), self.pos().z()),
              visible,
              standing.waypoints().size(),
              reflex.waypointIndex()));
    step.commands().forEach(this::apply);
    if (routed && doorway && self.pos().x() > 308 && attacks > 0) finish(true);
  }

  private void apply(BodyCommand command) {
    var id = attacker.orElseThrow();
    var owner = bodies.orElseThrow();
    switch (command) {
      case BodyCommand.MoveToward(var point, var sprint, var hop) ->
          owner.moveSafely(
              id,
              new com.shepherdjerred.thestorm.rwfbots.adapter.paper.Bodies.MotionTarget(
                  new Location(world, point.x(), point.y(), point.z()),
                  sprint,
                  hop,
                  Optional.of(BOUNDS),
                  reflex
                      .activeJump()
                      .filter(
                          active ->
                              active.stage()
                                  == com.shepherdjerred.thestorm.rwfbots.domain.reflex.ActiveJump
                                      .Stage.RUN_UP)
                      .flatMap(active -> active.waypoint().launch())));
      case BodyCommand.Look(var yaw, var pitch) -> owner.look(id, (float) yaw, (float) pitch);
      case BodyCommand.Jump _ -> owner.jump(id);
      case BodyCommand.Stop _ -> owner.stop(id);
      case BodyCommand.Sneak(var sneak) -> owner.sneak(id, sneak);
      case BodyCommand.SelectSlot(var slot) -> owner.selectSlot(id, slot);
      case BodyCommand.Attack _ -> attacks++;
      case BodyCommand.Swing _ -> swings++;
      default -> throw new IllegalStateException("unexpected pursuit command " + command);
    }
  }

  private record Pose(Vec3 point, Vec3 velocity, Facing facing, boolean grounded) {}

  private static CombatantView view(int id, TeamId team, Pose pose) {
    return new CombatantView(
        new CombatantId(id),
        team,
        false,
        Kit.TROOPER,
        true,
        pose.point(),
        pose.velocity(),
        pose.facing().yaw(),
        pose.facing().pitch(),
        20,
        0,
        0,
        1,
        false,
        pose.grounded(),
        false,
        false,
        -1,
        com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState.UNMODIFIED,
        com.shepherdjerred.thestorm.rwfbots.domain.world.Quiver.ENDLESS);
  }

  private void finish(boolean passed) {
    state = passed ? "passed" : "failed";
    clock.ifPresent(BukkitTask::cancel);
    clock = Optional.empty();
    attacker.ifPresent(id -> bodies.orElseThrow().stop(id));
  }

  private static final class Arena implements BlockClassification {
    @Override
    public GridBounds bounds() {
      return BOUNDS;
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      if (y == 99) return BlockShape.FULL;
      if (x == 307 && y <= 102 && z != 303 && z != 304) {
        return z == 308 || z == 309 ? BlockShape.PANE : BlockShape.FULL;
      }
      return BlockShape.PASSABLE;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return shape(x, y, z) == BlockShape.FULL;
    }
  }

  @Override
  public void close() {
    clock.ifPresent(BukkitTask::cancel);
    bodies.ifPresent(CitizensBodies::despawnAll);
    bodies.ifPresent(HandlerList::unregisterAll);
    for (int x = 300 >> 4; x <= 315 >> 4; x++)
      for (int z = 300 >> 4; z <= 311 >> 4; z++) {
        world.removePluginChunkTicket(x, z, plugin);
      }
  }
}
