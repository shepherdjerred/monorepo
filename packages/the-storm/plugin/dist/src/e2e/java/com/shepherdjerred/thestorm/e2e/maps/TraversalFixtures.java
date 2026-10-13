package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.rwfbots.adapter.citizens.CitizensBodies;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.PersonalityFiles;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.SnapshotCapture;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
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
      double damage) {}

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
      List<Scenario> scenarios) {
    static Wire load() {
      try (var stream = TraversalFixtures.class.getResourceAsStream("/rwf-traversal.json")) {
        if (stream == null) throw new IllegalStateException("traversal contract missing");
        var wire = JSON.readValue(stream, Wire.class);
        if (wire.version() != 2
            || !wire.states().equals(List.of("idle", "running", "passed", "failed"))
            || !wire.status().equals(components(Status.class))
            || !wire.sample().equals(components(Sample.class))
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
    if (bodies.isEmpty()) bodies = Optional.of(CitizensBodies.open(plugin, id -> {}));
    arena.tickets(plugin, true);
    arena.prepare(next.arena());
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
    var jump = false;
    if (ticks > SETTLE_TICKS) {
      driveTicks++;
      jump = route.isPresent() ? planned(player, id) : calibrated(selected, position, grounded, id);
    }
    var velocity = player.getVelocity();
    samples.add(
        new Sample(
            ticks,
            point(position),
            List.of(velocity.getX(), velocity.getY(), velocity.getZ()),
            player.getHealth(),
            player.getFallDistance(),
            grounded,
            liquid(player),
            player.isClimbing(),
            jump,
            damage));
    var goal = arena.at(selected.goal());
    if (driveTicks >= selected.minimumDriveTicks()
        && position.distanceSquared(goal) <= 0.49
        && (grounded || liquid(player) || player.isClimbing())) finish(true);
    if (player.isDead() || position.getY() < 94) finish(false);
  }

  private boolean calibrated(Scenario selected, Location position, boolean grounded, UUID id) {
    var owner = bodies.orElseThrow();
    owner.moveToward(id, target(selected, position), selected.sprint());
    if (!shouldJump(selected, position, grounded)) return false;
    owner.jump(id);
    jumps++;
    lastJump = ticks;
    return true;
  }

  private boolean planned(Player player, UUID id) {
    var commands = route.orElseThrow().tick(player, ticks);
    var owner = bodies.orElseThrow();
    for (var command : commands) {
      switch (command) {
        case BodyCommand.MoveToward(var point, var sprint) ->
            owner.moveToward(
                id, new Location(player.getWorld(), point.x(), point.y(), point.z()), sprint);
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
    if (List.of("ladder", "vine", "scaffolding").contains(selected.arena())
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
