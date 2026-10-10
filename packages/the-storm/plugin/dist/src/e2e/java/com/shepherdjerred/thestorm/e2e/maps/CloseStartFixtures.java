package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.rwf.app.map.MapLoading;
import com.shepherdjerred.thestorm.rwfbots.adapter.citizens.CitizensBodies;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.PersonalityFiles;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.SnapshotCapture;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.FluidCollisionMode;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.attribute.Attribute;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;
import org.bukkit.util.Vector;
import tools.jackson.databind.json.JsonMapper;

/** Test-only geometry and production-motor proof on an already prepared, unchanged original map. */
public final class CloseStartFixtures implements BasicCommand, AutoCloseable {
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private final JavaPlugin plugin;
  private final List<Sample> samples = new ArrayList<>();
  private Optional<CitizensBodies> bodies = Optional.empty();
  private Optional<UUID> body = Optional.empty();
  private Optional<BukkitTask> clock = Optional.empty();
  private List<Start> starts = List.of();
  private String state = "idle";
  private String map = "none";
  private String hash = "none";
  private String message = "";
  private boolean geometry;
  private int ticks;
  private int actor;
  private int actorTicks;
  private int stableTicks;
  private int legs;

  private record Start(double x, double y, double z, float yaw) {
    Start {
      if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z) || !Float.isFinite(yaw))
        throw new IllegalArgumentException("nonfinite start");
    }

    Location at(World world) {
      return new Location(world, x, y, z, yaw, 0);
    }
  }

  private record Sample(
      int tick,
      int actor,
      int legs,
      List<Double> position,
      double vy,
      boolean grounded,
      double width,
      double height,
      double stepHeight) {}

  private record Report(
      String state,
      String map,
      String blocksSha256,
      int ticks,
      int legs,
      boolean geometry,
      List<Start> starts,
      List<Sample> samples,
      String message) {}

  public CloseStartFixtures(JavaPlugin plugin) {
    this.plugin = plugin;
  }

  public void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> event.registrar().register("storm-fixture-close-starts", this));
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (!(source.getSender() instanceof RemoteConsoleCommandSender))
      throw new IllegalStateException("close-start proof requires the private RCON console");
    if (args.length == 11 && args[0].equals("start")) {
      start(args);
    } else if (args.length != 1 || !args[0].equals("status")) {
      throw new IllegalArgumentException(
          "expected start map terrainHash x y z yaw x y z yaw, or status");
    }
    source
        .getSender()
        .sendMessage(
            Component.text(
                JSON.writeValueAsString(
                    new Report(
                        state,
                        map,
                        hash,
                        ticks,
                        legs,
                        geometry,
                        starts,
                        List.copyOf(samples),
                        message))));
  }

  private void start(String[] args) {
    if (state.equals("running"))
      throw new IllegalStateException("close-start proof already running");
    releaseBody();
    map = args[1];
    hash = args[2];
    starts = List.of(parse(args, 3), parse(args, 7));
    state = "running";
    message = "";
    geometry = false;
    ticks = 0;
    legs = 0;
    actor = 0;
    samples.clear();
    try {
      var ready = readyMap();
      var world = world();
      for (var start : starts) {
        var feet =
            new com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos(
                (int) Math.floor(start.x()),
                (int) Math.floor(start.y()),
                (int) Math.floor(start.z()));
        if (!ready.region().contains(feet))
          throw new IllegalArgumentException("start outside original map");
        for (var dx = -1; dx <= 1; dx++)
          for (var dz = -1; dz <= 1; dz++) standing(start.at(world).add(dx, 0, dz));
      }
      var first = starts.getFirst().at(world);
      var second = starts.getLast().at(world);
      if (first.getY() != second.getY()
          || first.distance(second) < 1
          || first.distance(second) > 32)
        throw new IllegalArgumentException("invalid grounded diagnostic corridor");
      corridor(first, second);
      var eye = first.clone().add(0, 1.62, 0);
      var sight = second.clone().add(0, 1.62, 0).subtract(eye).toVector();
      if (world.rayTraceBlocks(eye, sight, sight.length(), FluidCollisionMode.ALWAYS, false)
          != null) throw new IllegalStateException("native eye-level sightline is obstructed");
      geometry = true;
      if (bodies.isEmpty()) bodies = Optional.of(CitizensBodies.open(plugin, id -> {}));
      spawn();
      clock = Optional.of(plugin.getServer().getScheduler().runTaskTimer(plugin, this::tick, 1, 1));
    } catch (RuntimeException failure) {
      finish(false, failure.toString());
    }
  }

  private static Start parse(String[] args, int index) {
    return new Start(
        Double.parseDouble(args[index]),
        Double.parseDouble(args[index + 1]),
        Double.parseDouble(args[index + 2]),
        Float.parseFloat(args[index + 3]));
  }

  private MapLoading.State readyMap() {
    var storm =
        (TheStormPlugin)
            Objects.requireNonNull(plugin.getServer().getPluginManager().getPlugin("TheStorm"));
    return storm.service(MapLoading.class).states().stream()
        .filter(
            entry -> entry.id().equals(map) && entry.blocksSha256().equals(hash) && entry.ready())
        .findFirst()
        .orElseThrow(() -> new IllegalStateException("original terrain is not prepared"));
  }

  private World world() {
    return Objects.requireNonNull(plugin.getServer().getWorld("rwf"));
  }

  private static void corridor(Location first, Location second) {
    var delta = second.clone().subtract(first).toVector();
    var steps = (int) Math.ceil(delta.length() * 4);
    for (var step = 0; step <= steps; step++) {
      var center = first.clone().add(delta.clone().multiply((double) step / steps));
      for (var dx : List.of(-0.3, 0.3))
        for (var dz : List.of(-0.3, 0.3)) standing(center.clone().add(dx, 0, dz));
    }
  }

  private static void standing(Location feet) {
    var world = Objects.requireNonNull(feet.getWorld());
    if (!world.isChunkLoaded(feet.getBlockX() >> 4, feet.getBlockZ() >> 4))
      throw new IllegalStateException("native proof would load an unprepared chunk");
    if (!feet.getBlock().getType().isAir()
        || !feet.clone().add(0, 1, 0).getBlock().getType().isAir())
      throw new IllegalStateException("native body clearance failed at " + feet);
    var floor =
        world.rayTraceBlocks(
            feet.clone().add(0, 0.01, 0),
            new Vector(0, -1, 0),
            0.02,
            FluidCollisionMode.ALWAYS,
            false);
    if (floor == null
        || Math.abs(floor.getHitPosition().getY() - feet.getY()) > 1.0e-6
        || !Objects.requireNonNull(floor.getHitBlock()).getType().isSolid())
      throw new IllegalStateException("native full-height support failed at " + feet);
  }

  private void spawn() {
    var catalog =
        PersonalityFiles.load(plugin.getDataFolder().toPath().getParent().resolve("TheStorm"));
    var personality =
        catalog.active().stream()
            .sorted(java.util.Comparator.comparing(p -> p.id()))
            .findFirst()
            .orElseThrow();
    var id = bodies.orElseThrow().create(personality);
    body = Optional.of(id);
    bodies.orElseThrow().spawn(id, starts.get(actor).at(world()));
    actorTicks = 0;
    stableTicks = 0;
  }

  private void tick() {
    ticks++;
    actorTicks++;
    try {
      readyMap();
      var id = body.orElseThrow();
      var player = bodies.orElseThrow().entity(id);
      if (player.isPresent()) observe(id, player.orElseThrow());
      if (state.equals("running") && actorTicks >= 400)
        finish(false, "native traversal exceeded 400 ticks per start");
    } catch (RuntimeException failure) {
      finish(false, failure.toString());
    }
  }

  private void observe(UUID id, org.bukkit.entity.Player player) {
    var position = player.getLocation();
    var expected = starts.get(actor);
    if (ticks % 10 == 0)
      samples.add(
          new Sample(
              ticks,
              actor,
              legs,
              List.of(position.getX(), position.getY(), position.getZ()),
              player.getVelocity().getY(),
              SnapshotCapture.onGround(player),
              player.getBoundingBox().getWidthX(),
              player.getBoundingBox().getHeight(),
              Objects.requireNonNull(player.getAttribute(Attribute.STEP_HEIGHT)).getValue()));
    if (actorTicks <= 20) return;
    if (Math.abs(position.getY() - expected.y()) > 0.03 || !SnapshotCapture.onGround(player))
      throw new IllegalStateException("native body left grounded corridor");
    if (stableTicks < 5) {
      if (position.distance(expected.at(world())) > 0.1)
        throw new IllegalStateException("native body did not settle at the authored start");
      stableTicks++;
      return;
    }
    var target = starts.get(legs % 2 == 0 ? 1 - actor : actor).at(world());
    if (position.distance(target) <= 0.4) {
      arrived(id);
    } else bodies.orElseThrow().moveToward(id, target, false);
  }

  private void arrived(UUID id) {
    bodies.orElseThrow().stop(id);
    legs++;
    if (legs % 2 != 0) return;
    releaseBody();
    actor++;
    if (actor == starts.size()) finish(true, "");
    else spawn();
  }

  private void finish(boolean passed, String detail) {
    state = passed ? "passed" : "failed";
    message = detail;
    clock.ifPresent(BukkitTask::cancel);
    clock = Optional.empty();
    releaseBody();
  }

  private void releaseBody() {
    body.ifPresent(id -> bodies.orElseThrow().despawn(id));
    body = Optional.empty();
  }

  @Override
  public void close() {
    clock.ifPresent(BukkitTask::cancel);
    releaseBody();
    bodies.ifPresent(CitizensBodies::despawnAll);
  }
}
