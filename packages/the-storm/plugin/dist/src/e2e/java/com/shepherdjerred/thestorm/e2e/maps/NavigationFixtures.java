package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.rwfbots.adapter.citizens.CitizensBodies;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.PersonalityFiles;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.type.Door;
import org.bukkit.block.data.type.Ladder;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;
import tools.jackson.databind.json.JsonMapper;

/** Native proof of the production Citizens motor and interaction gates in a disposable world. */
public final class NavigationFixtures implements BasicCommand, Listener, AutoCloseable {
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private static final int X = 200;
  private static final int Z = 200;
  private final JavaPlugin plugin;
  private final World world;
  private Optional<CitizensBodies> bodies = Optional.empty();
  private Optional<UUID> body = Optional.empty();
  private Optional<BukkitTask> clock = Optional.empty();
  private Optional<org.bukkit.entity.Cow> waterControl = Optional.empty();
  private String mode = "none";
  private String state = "idle";
  private int ticks;
  private int interactions;
  private double maximumY;
  private boolean jumped;
  private List<Double> last = List.of();
  private final java.util.ArrayList<Physics> physics = new java.util.ArrayList<>();

  private record Physics(
      int tick,
      double y,
      double vy,
      boolean inWater,
      String feet,
      String head,
      boolean controlInWater,
      double width,
      double height,
      double stepHeight) {}

  public NavigationFixtures(JavaPlugin plugin, World world) {
    this.plugin = plugin;
    this.world = world;
  }

  public void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> event.registrar().register("storm-fixture-navigation", this));
    plugin.getServer().getPluginManager().registerEvents(this, plugin);
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (!(source.getSender() instanceof ConsoleCommandSender)
        && !(source.getSender() instanceof RemoteConsoleCommandSender)) {
      throw new IllegalArgumentException(
          "navigation fixtures require the disposable server console");
    }
    if (args.length == 2 && args[0].equals("start")) start(args[1]);
    else if (args.length != 1 || !args[0].equals("status")) {
      throw new IllegalArgumentException("use start door|door-denied|ladder|water|leap, or status");
    }
    source
        .getSender()
        .sendMessage(
            Component.text(
                JSON.writeValueAsString(
                    Map.of(
                        "state",
                        state,
                        "mode",
                        mode,
                        "ticks",
                        ticks,
                        "position",
                        last,
                        "maximumY",
                        maximumY,
                        "interactions",
                        interactions,
                        "doorOpen",
                        doorOpen(),
                        "physics",
                        physics))));
  }

  private void start(String selected) {
    if (!List.of("door", "door-denied", "ladder", "water", "leap").contains(selected)) {
      throw new IllegalArgumentException("unknown navigation case");
    }
    if (state.equals("running")) throw new IllegalStateException("navigation case already running");
    body.ifPresent(id -> bodies.orElseThrow().despawn(id));
    waterControl.ifPresent(org.bukkit.entity.Entity::remove);
    waterControl = Optional.empty();
    if (bodies.isEmpty()) bodies = Optional.of(CitizensBodies.open(plugin, id -> {}));
    var catalog =
        PersonalityFiles.load(plugin.getDataFolder().toPath().getParent().resolve("TheStorm"));
    var personality =
        catalog.active().stream()
            .sorted(java.util.Comparator.comparing(p -> p.id()))
            .findFirst()
            .orElseThrow();
    clear();
    for (var x = (X - 1) >> 4; x <= (X + 11) >> 4; x++) {
      for (var z = (Z - 1) >> 4; z <= (Z + 3) >> 4; z++) world.addPluginChunkTicket(x, z, plugin);
    }
    mode = selected;
    switch (mode) {
      case "door", "door-denied" -> doorArena();
      case "ladder" -> ladderArena();
      case "water" -> waterArena();
      case "leap" -> leapArena();
      default -> throw new IllegalStateException(mode);
    }
    var id = bodies.orElseThrow().create(personality);
    body = Optional.of(id);
    bodies
        .orElseThrow()
        .spawn(
            id,
            at(
                mode.equals("leap") ? 0.5 : 1.5,
                mode.equals("leap") ? 105 : mode.equals("water") ? 99 : 100,
                1.5));
    if (mode.equals("water"))
      waterControl =
          Optional.of(
              world.spawn(at(3.5, 98, 0.5), org.bukkit.entity.Cow.class, cow -> cow.setAI(false)));
    ticks = 0;
    interactions = 0;
    maximumY = 0;
    jumped = false;
    last = List.of();
    physics.clear();
    state = "running";
    clock = Optional.of(plugin.getServer().getScheduler().runTaskTimer(plugin, this::tick, 1, 1));
  }

  private void tick() {
    ticks++;
    var id = body.orElseThrow();
    bodies.orElseThrow().entity(id).ifPresent(player -> observe(id, player));
    if (state.equals("running") && ticks >= 240) {
      finish(
          mode.equals("door-denied")
              && !doorOpen()
              && interactions > 0
              && !last.isEmpty()
              && last.getFirst() < 5);
    }
  }

  private void observe(UUID id, org.bukkit.entity.Player player) {
    var position = player.getLocation();
    maximumY = Math.max(maximumY, position.getY());
    last = List.of(position.getX() - X, position.getY(), position.getZ() - Z);
    if (ticks % 20 == 0) recordPhysics(player, position);
    // Allow normal skin application and gravity before issuing movement commands.
    if (ticks > 20) drive(id, position);
    if (!mode.equals("door-denied") && reached(position)) finish(true);
  }

  private void recordPhysics(org.bukkit.entity.Player player, Location position) {
    physics.add(
        new Physics(
            ticks,
            position.getY(),
            player.getVelocity().getY(),
            player.isInWater(),
            position.getBlock().getType().name(),
            position.clone().add(0, 1, 0).getBlock().getType().name(),
            waterControl.map(org.bukkit.entity.Entity::isInWater).orElse(false),
            player.getBoundingBox().getWidthX(),
            player.getBoundingBox().getHeight(),
            java.util.Objects.requireNonNull(
                    player.getAttribute(org.bukkit.attribute.Attribute.STEP_HEIGHT))
                .getValue()));
  }

  private void drive(UUID id, Location position) {
    var target =
        mode.equals("ladder") && position.getY() < 104.2
            ? at(1.5, 104.5, 1.5)
            : mode.equals("ladder") ? at(1.5, 105, 0.5) : at(9.5, 100, 1.5);
    bodies.orElseThrow().moveToward(id, target, mode.equals("leap"));
    if (mode.equals("leap") && !jumped) {
      bodies.orElseThrow().jump(id);
      jumped = true;
    }
  }

  private boolean reached(Location position) {
    return mode.equals("ladder")
        ? position.getY() >= 104.9 && position.getZ() - Z < 1
        : position.getX() - X >= 8.5 && position.getY() >= 99.9;
  }

  private void finish(boolean passed) {
    state = passed ? "passed" : "failed";
    clock.ifPresent(BukkitTask::cancel);
    clock = Optional.empty();
    body.ifPresent(id -> bodies.orElseThrow().stop(id));
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void interaction(PlayerInteractEvent event) {
    if (!state.equals("running")
        || body.isEmpty()
        || !event.getPlayer().getUniqueId().equals(body.orElseThrow())) return;
    interactions++;
    if (mode.equals("door-denied")) event.setUseInteractedBlock(Event.Result.DENY);
  }

  private Location at(double x, double y, double z) {
    return new Location(world, X + x, y, Z + z);
  }

  private void set(int x, int y, int z, Material material) {
    world.getBlockAt(X + x, y, Z + z).setType(material, false);
  }

  private void clear() {
    for (var x = -1; x <= 11; x++)
      for (var z = -1; z <= 3; z++) {
        for (var y = 96; y <= 108; y++) set(x, y, z, Material.AIR);
      }
  }

  private void floor(int y) {
    for (var x = 0; x <= 10; x++) for (var z = 0; z <= 2; z++) set(x, y, z, Material.STONE);
  }

  private void doorArena() {
    floor(99);
    for (var y = 100; y <= 102; y++) for (var z = 0; z <= 2; z++) set(5, y, z, Material.STONE);
    for (var y = 100; y <= 101; y++) {
      var block = world.getBlockAt(X + 5, y, Z + 1);
      var data = (Door) Material.OAK_DOOR.createBlockData();
      data.setFacing(BlockFace.EAST);
      data.setHalf(y == 100 ? Bisected.Half.BOTTOM : Bisected.Half.TOP);
      data.setOpen(false);
      block.setBlockData(data, false);
    }
  }

  private boolean doorOpen() {
    return world.getBlockAt(X + 5, 100, Z + 1).getBlockData() instanceof Door door && door.isOpen();
  }

  private void ladderArena() {
    floor(99);
    for (var y = 100; y <= 104; y++) {
      set(1, y, 2, Material.STONE);
      var ladder = (Ladder) Material.LADDER.createBlockData();
      ladder.setFacing(BlockFace.NORTH);
      world.getBlockAt(X + 1, y, Z + 1).setBlockData(ladder, false);
    }
    set(1, 104, 0, Material.STONE);
  }

  private void waterArena() {
    floor(96);
    for (var x = 0; x <= 10; x++)
      for (var z = 0; z <= 2; z++) {
        for (var y = 97; y <= 99; y++) set(x, y, z, x <= 6 ? Material.WATER : Material.STONE);
      }
  }

  private void leapArena() {
    for (var z = 0; z <= 2; z++) {
      set(0, 104, z, Material.STONE);
      for (var x = 3; x <= 10; x++) set(x, 99, z, Material.STONE);
    }
  }

  @Override
  public void close() {
    clock.ifPresent(BukkitTask::cancel);
    bodies.ifPresent(CitizensBodies::despawnAll);
    waterControl.ifPresent(org.bukkit.entity.Entity::remove);
    waterControl = Optional.empty();
    bodies.ifPresent(HandlerList::unregisterAll);
    HandlerList.unregisterAll(this);
    clock = Optional.empty();
    body = Optional.empty();
    bodies = Optional.empty();
    for (var x = (X - 1) >> 4; x <= (X + 11) >> 4; x++) {
      for (var z = (Z - 1) >> 4; z <= (Z + 3) >> 4; z++)
        world.removePluginChunkTicket(x, z, plugin);
    }
  }
}
