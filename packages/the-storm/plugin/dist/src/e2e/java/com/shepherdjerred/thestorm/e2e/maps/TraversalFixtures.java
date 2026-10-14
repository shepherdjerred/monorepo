package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.rwfbots.adapter.citizens.CitizensBodies;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.PersonalityFiles;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.Bodies;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.SnapshotCapture;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;
import tools.jackson.databind.json.JsonMapper;

/** Per-tick calibration of the real production Citizens motor in disposable collision courses. */
public final class TraversalFixtures implements BasicCommand, Listener, AutoCloseable {
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private static final Wire WIRE = Wire.load();
  private static final int SETTLE_TICKS = 20;
  private final JavaPlugin plugin;
  private final TraversalArena arena;
  private final List<Sample> samples = new ArrayList<>();
  private Optional<CitizensBodies> bodies = Optional.empty();
  private Optional<UUID> body = Optional.empty();
  private Optional<Scenario> scenario = Optional.empty();
  private Optional<TraversalRoute> route = Optional.empty();
  private Optional<GridBounds> courseBounds = Optional.empty();
  private Optional<BukkitTask> clock = Optional.empty();
  private String state = "idle";
  private int ticks;
  private int driveTicks;
  private int jumps;
  private int lastJump;
  private double damage;

  private record Scenario(
      String id,
      String arena,
      List<Double> start,
      List<Double> goal,
      boolean sprint,
      double jumpDistance,
      boolean repeatJump,
      int minimumDriveTicks,
      int maxTicks) {}

  private record Sample(
      int tick,
      List<Double> position,
      List<Double> velocity,
      double health,
      double fallDistance,
      boolean onGround,
      boolean inWater,
      boolean climbing,
      boolean jump,
      double damage,
      List<TraversalState> capturedTraversal) {}

  private record Status(
      int version,
      String state,
      String scenario,
      int ticks,
      int driveTicks,
      String body,
      List<Sample> samples) {}

  private record Wire(
      int version,
      List<String> states,
      List<String> status,
      List<String> sample,
      List<String> traversal,
      List<Scenario> scenarios) {
    static Wire load() {
      try (var stream = TraversalFixtures.class.getResourceAsStream("/rwf-traversal.json")) {
        if (stream == null) throw new IllegalStateException("traversal contract missing");
        var wire = JSON.readValue(stream, Wire.class);
        if (wire.version() != 3
            || !wire.states().equals(List.of("idle", "running", "passed", "failed"))
            || !wire.status().equals(components(Status.class))
            || !wire.sample().equals(components(Sample.class))
            || !wire.traversal().equals(components(TraversalState.class))
            || wire.scenarios().isEmpty())
          throw new IllegalStateException("traversal contract differs from producer");
        var ids = new java.util.HashSet<String>();
        for (var candidate : wire.scenarios()) {
          if (!ids.add(candidate.id()))
            throw new IllegalStateException("duplicate traversal scenario " + candidate.id());
          validate(candidate);
        }
        return wire;
      } catch (IOException failure) {
        throw new IllegalStateException("traversal contract unreadable", failure);
      }
    }

    private static void validate(Scenario candidate) {
      if (candidate.start().size() != 3
          || candidate.goal().size() != 3
          || candidate.minimumDriveTicks() < 1
          || candidate.minimumDriveTicks() > candidate.maxTicks() - SETTLE_TICKS
          || candidate.maxTicks() <= SETTLE_TICKS
          || candidate.maxTicks() > 600)
        throw new IllegalStateException("invalid traversal scenario " + candidate.id());
    }

    private static List<String> components(Class<?> record) {
      return Arrays.stream(record.getRecordComponents())
          .map(java.lang.reflect.RecordComponent::getName)
          .toList();
    }
  }

  public TraversalFixtures(JavaPlugin plugin, World world) {
    this.plugin = plugin;
    arena = new TraversalArena(world);
  }

  public void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> event.registrar().register("storm-fixture-traversal", this));
    plugin.getServer().getPluginManager().registerEvents(this, plugin);
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (!(source.getSender() instanceof ConsoleCommandSender)
        && !(source.getSender() instanceof RemoteConsoleCommandSender))
      throw new IllegalArgumentException(
          "traversal calibration requires disposable server console");
    if (args.length == 1 && args[0].equals("contract")) {
      source.getSender().sendMessage(Component.text(JSON.writeValueAsString(WIRE)));
      return;
    }
    if (args.length == 2 && (args[0].equals("start") || args[0].equals("start-route")))
      start(args[1], args[0].equals("start-route"));
    else if (args.length != 1 || !args[0].equals("status"))
      throw new IllegalArgumentException("use start/start-route <scenario>, status or contract");
    source
        .getSender()
        .sendMessage(
            Component.text(
                JSON.writeValueAsString(
                    new Status(
                        WIRE.version(),
                        state,
                        scenario.map(Scenario::id).orElse("none"),
                        ticks,
                        driveTicks,
                        body.map(UUID::toString).orElse("none"),
                        samples))));
  }

  private void start(String selected, boolean planned) {
    if (state.equals("running")) throw new IllegalStateException("traversal already running");
    var next =
        WIRE.scenarios().stream()
            .filter(value -> value.id().equals(selected))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("unknown traversal " + selected));
    body.ifPresent(id -> bodies.orElseThrow().despawn(id));
    if (bodies.isEmpty())
      bodies =
          Optional.of(
              CitizensBodies.open(
                  plugin,
                  id -> {},
                  new SnapshotCapture.Capabilities(
                      id -> Optional.empty(),
                      java.time.InstantSource.fixed(java.time.Instant.EPOCH))));
    arena.tickets(plugin, true);
    arena.prepare(next.arena());
    courseBounds = Optional.of(arena.snapshot().bounds());
    route =
        planned
            ? Optional.of(
                new TraversalRoute(arena.snapshot(), arena.at(next.goal()), next.sprint()))
            : Optional.empty();
    var personality =
        PersonalityFiles.load(plugin.getDataFolder().toPath().getParent().resolve("TheStorm"))
            .active()
            .stream()
            .sorted(java.util.Comparator.comparing(value -> value.id()))
            .findFirst()
            .orElseThrow();
    var id = bodies.orElseThrow().create(personality);
    body = Optional.of(id);
    bodies.orElseThrow().spawn(id, arena.at(next.start()));
    scenario = Optional.of(next);
    ticks = 0;
    driveTicks = 0;
    jumps = 0;
    lastJump = 0;
    damage = 0;
    samples.clear();
    state = "running";
    clock = Optional.of(plugin.getServer().getScheduler().runTaskTimer(plugin, this::tick, 1, 1));
  }

  private void tick() {
    ticks++;
    var owner = bodies.orElseThrow();
    var id = body.orElseThrow();
    if (ticks == SETTLE_TICKS) {
      var prepared = owner.move(id, arena.at(scenario.orElseThrow().start()));
      prepared.setVelocity(new org.bukkit.util.Vector());
      prepared.setFallDistance(0);
    }
    var player = owner.entity(id);
    if (player.isPresent()) observe(player.orElseThrow(), id);
    if (state.equals("running") && ticks >= scenario.orElseThrow().maxTicks()) finish(false);
  }

  private void observe(Player player, UUID id) {
    var selected = scenario.orElseThrow();
    var position = player.getLocation();
    var grounded = SnapshotCapture.onGround(player);
    // Compare capture to the same pre-command phase: the real motor can cancel fall distance
    // during this command after verified water/climb contact, without changing health.
    var fallDistance = player.getFallDistance();
    var jump = false;
    if (ticks > SETTLE_TICKS) {
      driveTicks++;
      jump = route.isPresent() ? planned(player, id) : calibrated(selected, player, grounded, id);
    }
    var velocity = player.getVelocity();
    samples.add(
        new Sample(
            ticks,
            point(position),
            List.of(velocity.getX(), velocity.getY(), velocity.getZ()),
            player.getHealth(),
            fallDistance,
            grounded,
            liquid(player),
            player.isClimbing(),
            jump,
            damage,
            route.flatMap(TraversalRoute::capturedTraversal).stream().toList()));
    var goal = arena.at(selected.goal());
    if (driveTicks >= selected.minimumDriveTicks()
        && position.distanceSquared(goal) <= 0.49
        && ((grounded && fallDistance == 0) || liquid(player) || player.isClimbing())) finish(true);
    if (player.isDead() || position.getY() < 94) finish(false);
  }

  private boolean calibrated(Scenario selected, Player player, boolean grounded, UUID id) {
    var owner = bodies.orElseThrow();
    var position = player.getLocation();
    var control = calibration(selected, position, grounded || liquid(player));
    owner.moveSafely(
        id,
        new Bodies.MotionTarget(control.target(), selected.sprint(), control.hop(), courseBounds));
    if (!shouldJump(selected, position, grounded)) return false;
    owner.jump(id);
    jumps++;
    lastJump = ticks;
    return true;
  }

  private record Calibration(Location target, Hop hop) {}

  /** Fixed course instructions exercise the final native gate without substituting the planner. */
  private Calibration calibration(Scenario selected, Location position, boolean contact) {
    return switch (selected.arena()) {
      case "water" -> new Calibration(waterTarget(selected, position), Hop.SWIM);
      case "water-throat" -> new Calibration(throatTarget(selected, position), Hop.SWIM);
      case "water-step" -> new Calibration(waterStepTarget(selected, position), Hop.SWIM);
      case "ladder", "vine", "scaffolding", "wet-ladder" ->
          new Calibration(target(selected, position), Hop.CLIMB);
      default -> dryCalibration(selected, position, contact);
    };
  }

  private Calibration dryCalibration(Scenario selected, Location position, boolean contact) {
    var first = firstLanding(selected);
    if (first.isEmpty()) {
      var hop = (!contact && selected.arena().equals("flat")) ? Hop.LEAP : Hop.WALK;
      return new Calibration(
          hop == Hop.LEAP ? nearbyLanding(selected, position) : arena.at(selected.goal()), hop);
    }
    var landing = first.orElseThrow();
    var origin = arena.at(selected.start()).toVector();
    var direction = arena.at(selected.goal()).toVector().subtract(origin).setY(0).normalize();
    var traveled = position.toVector().subtract(origin).setY(0).dot(direction);
    var required = landing.target().toVector().subtract(origin).setY(0).dot(direction);
    if (contact && traveled >= required - 0.3)
      return new Calibration(arena.at(selected.goal()), Hop.WALK);
    if (position.toVector().subtract(landing.target().toVector()).setY(0).length() > 6)
      return new Calibration(arena.at(selected.goal()), Hop.WALK);
    return landing;
  }

  private Optional<Calibration> firstLanding(Scenario selected) {
    var height = selected.goal().get(1);
    return switch (selected.arena()) {
      case "flat", "low-ceiling" -> Optional.empty();
      case "step" -> Optional.of(new Calibration(arena.at(List.of(3.5, height, 2.5)), Hop.JUMP));
      case "diagonal-step" ->
          Optional.of(new Calibration(arena.at(List.of(3.5, height, 3.5)), Hop.JUMP));
      case "slab" -> Optional.of(new Calibration(arena.at(List.of(3.5, 100.5, 2.5)), Hop.JUMP));
      case "gap-two", "gap-two-up" ->
          Optional.of(new Calibration(arena.at(List.of(5.5, height, 2.5)), Hop.LEAP));
      case "gap-three", "gap-three-down" ->
          Optional.of(new Calibration(arena.at(List.of(6.5, height, 2.5)), Hop.LEAP));
      case "diagonal-gap" ->
          Optional.of(new Calibration(arena.at(List.of(5.5, height, 5.5)), Hop.LEAP));
      case "drop-four", "drop-eight", "drop-water" ->
          Optional.of(new Calibration(arena.at(List.of(3.5, height, 2.5)), Hop.DROP));
      default ->
          throw new IllegalArgumentException("unknown dry calibration course " + selected.arena());
    };
  }

  private Location nearbyLanding(Scenario selected, Location position) {
    var goal = arena.at(selected.goal());
    var direction = goal.toVector().subtract(position.toVector()).setY(0);
    var distance = Math.min(3, direction.length());
    if (distance == 0) return goal;
    var landing = position.clone().add(direction.normalize().multiply(distance));
    landing.setY(goal.getY());
    return landing;
  }

  private Location waterTarget(Scenario selected, Location position) {
    if (selected.goal().get(0) <= 8.5) return arena.at(selected.goal());
    if (position.getX() < arena.at(List.of(8.1, 99.6, 2.5)).getX() || position.getY() < 99.35)
      return arena.at(List.of(8.5, 99.6, 2.5));
    return arena.at(selected.goal());
  }

  private Location throatTarget(Scenario selected, Location position) {
    if (position.getX() < arena.at(List.of(5.4, 96.0, 2.5)).getX()) {
      if (position.getY() > 96.2) {
        var down = position.clone();
        down.setY(96);
        return down;
      }
      return arena.at(List.of(7.5, 96.0, 2.5));
    }
    return waterTarget(selected, position);
  }

  private Location waterStepTarget(Scenario selected, Location position) {
    if (selected.goal().get(1) < selected.start().get(1)) {
      return position.getX() > arena.at(List.of(3.7, 100.0, 2.5)).getX()
          ? arena.at(List.of(3.5, 100.0, 2.5))
          : arena.at(selected.goal());
    }
    return (position.getX() < arena.at(List.of(3.0, 99.6, 2.5)).getX() || position.getY() < 99.35)
        ? arena.at(List.of(3.5, 99.6, 2.5))
        : arena.at(selected.goal());
  }

  private boolean planned(Player player, UUID id) {
    var commands = route.orElseThrow().tick(player, ticks);
    var owner = bodies.orElseThrow();
    for (var command : commands) {
      switch (command) {
        case BodyCommand.MoveToward(var point, var sprint, var hop) ->
            owner.moveSafely(
                id,
                new com.shepherdjerred.thestorm.rwfbots.adapter.paper.Bodies.MotionTarget(
                    new Location(player.getWorld(), point.x(), point.y(), point.z()),
                    sprint,
                    hop,
                    Optional.of(route.orElseThrow().bounds()),
                    route.orElseThrow().runUp()));
        case BodyCommand.Look(var yaw, var pitch) -> owner.look(id, (float) yaw, (float) pitch);
        case BodyCommand.Stop _ -> owner.stop(id);
        case BodyCommand.Jump _ -> owner.jump(id);
        case BodyCommand.Sneak(var sneak) -> owner.sneak(id, sneak);
        case BodyCommand.SelectSlot(var slot) -> owner.selectSlot(id, slot);
        case BodyCommand.CancelUse _ -> owner.stopUsing(id, false);
        default ->
            throw new IllegalStateException("unexpected route calibration command " + command);
      }
    }
    return commands.stream().anyMatch(command -> command instanceof BodyCommand.Jump);
  }

  private boolean shouldJump(Scenario selected, Location position, boolean grounded) {
    var origin = arena.at(selected.start());
    var traveled = Math.hypot(position.getX() - origin.getX(), position.getZ() - origin.getZ());
    if (!grounded || selected.jumpDistance() < 0 || traveled < selected.jumpDistance())
      return false;
    if (jumps == 0) return true;
    var goal = arena.at(selected.goal());
    var remaining = Math.hypot(goal.getX() - position.getX(), goal.getZ() - position.getZ());
    // Native v2 flight: 0.48 launch + eleven 0.28 steps. Leave room for a grounded arrival.
    return selected.repeatJump() && ticks - lastJump >= 10 && remaining >= 3.6;
  }

  private Location target(Scenario selected, Location position) {
    if (selected.arena().equals("water-throat")
        && position.getX() < arena.at(List.of(4.8, 96.0, 2.5)).getX())
      return arena.at(List.of(7.5, 96.0, 2.5));
    if (List.of("ladder", "vine", "scaffolding", "wet-ladder").contains(selected.arena())
        && position.getY() < 104.2) return arena.at(List.of(1.5, 104.5, 2.5));
    return arena.at(selected.goal());
  }

  private static boolean liquid(Player player) {
    return player.isInWater()
        || liquid(player.getLocation().getBlock())
        || liquid(player.getEyeLocation().getBlock());
  }

  private static boolean liquid(org.bukkit.block.Block block) {
    return block.isLiquid()
        || (block.getBlockData() instanceof org.bukkit.block.data.Waterlogged data
            && data.isWaterlogged());
  }

  private static List<Double> point(Location position) {
    return List.of(position.getX(), position.getY(), position.getZ());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void damage(EntityDamageEvent event) {
    if (state.equals("running") && body.filter(event.getEntity().getUniqueId()::equals).isPresent())
      damage += event.getFinalDamage();
  }

  private void finish(boolean passed) {
    state = passed ? "passed" : "failed";
    clock.ifPresent(BukkitTask::cancel);
    clock = Optional.empty();
    body.ifPresent(id -> bodies.orElseThrow().stop(id));
  }

  @Override
  public void close() {
    clock.ifPresent(BukkitTask::cancel);
    bodies.ifPresent(CitizensBodies::despawnAll);
    bodies.ifPresent(HandlerList::unregisterAll);
    HandlerList.unregisterAll(this);
    arena.tickets(plugin, false);
  }
}
