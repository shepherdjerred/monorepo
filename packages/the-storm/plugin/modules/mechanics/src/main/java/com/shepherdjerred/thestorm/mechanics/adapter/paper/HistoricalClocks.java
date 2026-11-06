package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.Server;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Sign;
import org.bukkit.block.data.FaceAttachable;
import org.bukkit.block.data.type.Switch;
import org.bukkit.block.data.type.WallSign;
import org.bukkit.block.sign.Side;

/** Restores surveyed MC1421 clocks only while their owners and exact layouts still match. */
final class HistoricalClocks {
  private record Clock(
      int x,
      int y,
      int z,
      BlockFace facing,
      Material input,
      Material support,
      int interval,
      Optional<UUID> owner) {}

  private static final UUID LYSERGIA_OWNER =
      UUID.fromString("5c3e630c-19ca-4354-9318-60f8b1fd566a");
  private static final List<Clock> CLOCKS =
      List.of(
          new Clock(
              71,
              57,
              -39,
              BlockFace.NORTH,
              Material.AIR,
              Material.COBBLESTONE,
              20,
              Optional.empty()),
          new Clock(
              1237,
              66,
              -788,
              BlockFace.WEST,
              Material.DIRT,
              Material.DIRT,
              20,
              Optional.of(LYSERGIA_OWNER)),
          new Clock(
              1244,
              65,
              -788,
              BlockFace.SOUTH,
              Material.DIRT,
              Material.COBBLESTONE,
              15,
              Optional.of(LYSERGIA_OWNER)));
  private final Kit kit;
  private final Protection protection;
  private final Server server;

  private record Circuit(
      Sign sign,
      Switch lever,
      org.bukkit.block.Block input,
      org.bukkit.block.Block support,
      org.bukkit.block.Block output) {}

  HistoricalClocks(Kit kit, Protection protection, Server server) {
    this.kit = kit;
    this.protection = protection;
    this.server = server;
  }

  void start() {
    // CraftBook's documented default self-trigger interval was two server ticks.
    kit.scheduler().repeatOnMainThread(Duration.ofMillis(100), Duration.ofMillis(100), this::tick);
  }

  void tick() {
    var world = server.getWorld("world");
    if (world == null || kit.sealed(world)) return;
    for (var clock : CLOCKS) tick(world, clock);
  }

  private void tick(org.bukkit.World world, Clock clock) {
    var x = clock.x();
    var y = clock.y();
    var z = clock.z();
    var dx = clock.facing().getModX();
    var dz = clock.facing().getModZ();
    if (!world.isChunkLoaded(x >> 4, z >> 4)
        || !world.isChunkLoaded((x + dx) >> 4, (z + dz) >> 4)
        || !world.isChunkLoaded((x - 2 * dx) >> 4, (z - 2 * dz) >> 4)) return;
    var block = world.getBlockAt(x, y, z);
    var input = world.getBlockAt(x + dx, y, z + dz);
    var support = world.getBlockAt(x - dx, y, z - dz);
    var circuit = circuit(clock, block, input, support);
    if (circuit.isEmpty()) return;
    var found = circuit.orElseThrow();
    var count = counter(found.sign(), clock);
    if (count.isEmpty() || !authorized(clock, block, found)) return;
    var next = (count.getAsInt() + 1) % clock.interval();
    found.sign().getSide(Side.FRONT).line(3, Component.text(Integer.toString(next)));
    if (!found.sign().update(false, false)) return;
    if (next == 0) {
      found.lever().setPowered(!found.lever().isPowered());
      found.output().setBlockData(found.lever(), true);
    }
  }

  private static Optional<Circuit> circuit(
      Clock clock,
      org.bukkit.block.Block block,
      org.bukkit.block.Block input,
      org.bukkit.block.Block support) {
    var output = support.getRelative(clock.facing().getOppositeFace());
    if (!(block.getState() instanceof Sign sign)
        || !(block.getBlockData() instanceof WallSign wall)
        || wall.getFacing() != clock.facing()
        || input.getType() != clock.input()
        || input.isBlockIndirectlyPowered()
        || support.getType() != clock.support()
        || output.getType() != Material.LEVER
        || !(output.getBlockData() instanceof Switch lever)
        || lever.getAttachedFace() != FaceAttachable.AttachedFace.WALL
        || lever.getFacing() != clock.facing().getOppositeFace()) return Optional.empty();
    return Optional.of(new Circuit(sign, lever, input, support, output));
  }

  private static java.util.OptionalInt counter(Sign sign, Clock clock) {
    var lines = PaperGrid.frontLines(sign);
    if (!lines
        .subList(0, 3)
        .equals(List.of("CLOCK", "[MC1421]", Integer.toString(clock.interval()))))
      return java.util.OptionalInt.empty();
    int count;
    try {
      count = Integer.parseInt(lines.get(3));
    } catch (NumberFormatException ignored) {
      return java.util.OptionalInt.empty();
    }
    return count < 0 || count >= clock.interval()
        ? java.util.OptionalInt.empty()
        : java.util.OptionalInt.of(count);
  }

  private boolean authorized(Clock clock, org.bukkit.block.Block block, Circuit circuit) {
    for (var part : List.of(block, circuit.input(), circuit.support(), circuit.output())) {
      var location = part.getLocation();
      var allowed =
          clock.owner().isPresent()
              ? protection
                  .check(clock.owner().orElseThrow(), ProtectedAction.BUILD, location)
                  .isAllowed()
              : protection.mayOperateServerHistoricalCircuit(location);
      if (!allowed || !protection.sameLand(block.getLocation(), location)) return false;
    }
    return true;
  }
}
