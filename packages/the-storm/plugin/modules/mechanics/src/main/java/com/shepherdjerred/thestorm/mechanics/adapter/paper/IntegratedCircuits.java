/*
 * Copyright (C) 2010, 2011 sk89q <https://github.com/sk89q>
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
 * License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with this program. If not,
 * see <https://www.gnu.org/licenses/>.
 */
package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.world.LoadedBlockEntities;
import com.shepherdjerred.thestorm.mechanics.domain.ic.CircuitTag;
import com.shepherdjerred.thestorm.mechanics.domain.ic.WirelessBands;
import java.time.Duration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Chunk;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Sign;
import org.bukkit.block.data.FaceAttachable;
import org.bukkit.block.data.Powerable;
import org.bukkit.block.data.type.Switch;
import org.bukkit.block.data.type.WallSign;
import org.bukkit.block.sign.Side;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockRedstoneEvent;
import org.bukkit.event.block.SignChangeEvent;
import org.bukkit.event.world.ChunkLoadEvent;
import org.bukkit.event.world.ChunkUnloadEvent;

/** World-derived ports of CraftBook logic ICs; upstream revision is recorded in NOTICE. */
final class IntegratedCircuits implements Listener {
  private record Key(UUID world, int x, int y, int z) {}

  private record Circuit(
      Block block, Sign sign, CircuitTag tag, List<Block> inputs, Block output) {}

  private final ModuleContext context;
  private final Kit kit;
  private final Protection protection;
  private final Map<Key, Block> circuits = new HashMap<>();
  private final Set<Key> pending = new HashSet<>();
  private final Map<Key, String> problems = new HashMap<>();
  private final WirelessBands<Key> wireless = new WirelessBands<>();
  private final Map<Key, UUID> transmitters = new HashMap<>();
  private final FarmCircuits farms;

  IntegratedCircuits(ModuleContext context, Kit kit, Protection protection) {
    this.context = context;
    this.kit = kit;
    this.protection = protection;
    farms = new FarmCircuits(new CircuitAccess(context, kit, protection));
  }

  void start() {
    for (var world : context.plugin().getServer().getWorlds()) {
      if (!kit.sealed(world)) for (var chunk : world.getLoadedChunks()) scan(chunk);
    }
    kit.scheduler()
        .repeatOnMainThread(
            Duration.ofMillis(100),
            Duration.ofMillis(100),
            () -> {
              for (var block : List.copyOf(circuits.values())) evaluate(block, true);
            });
  }

  @EventHandler
  void onLoad(ChunkLoadEvent event) {
    if (!kit.sealed(event.getWorld())) scan(event.getChunk());
  }

  @EventHandler(ignoreCancelled = true)
  void onUnload(ChunkUnloadEvent event) {
    var chunk = event.getChunk();
    var removed =
        circuits.keySet().stream()
            .filter(
                key ->
                    key.world().equals(event.getWorld().getUID())
                        && key.x() >> 4 == chunk.getX()
                        && key.z() >> 4 == chunk.getZ())
            .toList();
    removed.forEach(
        key -> {
          circuits.remove(key);
          pending.remove(key);
          problems.remove(key);
          wireless.forget(key);
          transmitters.remove(key);
        });
  }

  private void scan(Chunk chunk) {
    for (var state : context.services().require(LoadedBlockEntities.class).inChunk(chunk)) {
      if (state instanceof Sign) remember(state.getBlock());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onWrite(SignChangeEvent event) {
    if (event.getSide() == Side.FRONT)
      kit.scheduler().runOnMainThread(() -> remember(event.getBlock()));
  }

  @EventHandler
  void onRedstone(BlockRedstoneEvent event) {
    var source = event.getBlock();
    if (kit.sealed(source.getWorld()) || (event.getOldCurrent() > 0) == (event.getNewCurrent() > 0))
      return;
    for (var dx = -2; dx <= 2; dx++)
      for (var dy = -1; dy <= 1; dy++)
        for (var dz = -2; dz <= 2; dz++) {
          var key =
              new Key(
                  source.getWorld().getUID(),
                  source.getX() + dx,
                  source.getY() + dy,
                  source.getZ() + dz);
          var block = circuits.get(key);
          if (block != null && pending.add(key))
            kit.scheduler()
                .runOnMainThread(
                    () -> {
                      pending.remove(key);
                      evaluate(block, false);
                    });
        }
  }

  private void remember(Block block) {
    if (site(block).isPresent()) {
      circuits.put(key(block), block);
      evaluate(block, false);
    }
  }

  private Optional<Circuit> site(Block block) {
    if (!PaperGrid.loaded(block)
        || !(block.getState(false) instanceof Sign sign)
        || !(block.getBlockData() instanceof WallSign wall)) return Optional.empty();
    var tag = CircuitTag.parse(PaperGrid.frontLines(sign).get(1));
    if (tag.isEmpty()) return Optional.empty();
    var facing = wall.getFacing();
    var left =
        switch (facing) {
          case NORTH -> BlockFace.EAST;
          case EAST -> BlockFace.SOUTH;
          case SOUTH -> BlockFace.WEST;
          case WEST -> BlockFace.NORTH;
          default -> throw new IllegalStateException("a wall circuit must face horizontally");
        };
    var inputs =
        tag.orElseThrow().kind() == CircuitTag.Kind.AND
            ? List.of(
                block.getRelative(facing),
                block.getRelative(left),
                block.getRelative(left.getOppositeFace()))
            : List.of(block.getRelative(facing));
    var output = block.getRelative(facing.getOppositeFace(), 2);
    return Optional.of(new Circuit(block, sign, tag.orElseThrow(), inputs, output));
  }

  private void evaluate(Block block, boolean poll) {
    var found = site(block);
    if (found.isEmpty()) {
      circuits.remove(key(block));
      problems.remove(key(block));
      wireless.forget(key(block));
      transmitters.remove(key(block));
      return;
    }
    var circuit = found.orElseThrow();
    // Retain the index while a neighboring chunk is unloaded; polling/edges resume once it loads.
    if (circuit.inputs().stream().anyMatch(input -> !PaperGrid.loaded(input))
        || !PaperGrid.loaded(circuit.output())) return;
    if (kit.sealed(block.getWorld()) || (poll && !circuit.tag().selfTriggered())) return;
    if (!poll && circuit.tag().kind() == CircuitTag.Kind.CLOCK) return;
    var owner =
        kit.signs().owner(circuit.sign()).or(() -> protection.automationActor(block.getLocation()));
    if (!authorized(circuit, owner)) {
      problem(block, "no permitted land editor for this circuit and its pins");
      return;
    }
    if (circuit.tag().kind().farming())
      runFarm(circuit, owner.orElse(Protection.SERVER_AUTOMATION), poll);
    else runLogic(circuit, owner.orElse(Protection.SERVER_AUTOMATION), poll);
  }

  private boolean authorized(Circuit circuit, Optional<UUID> owner) {
    var block = circuit.block();
    var pins = new java.util.ArrayList<>(circuit.inputs());
    if (circuit.output().getType() == Material.LEVER) pins.add(circuit.output());
    if (protection.mayOperateServerHistoricalCircuit(block.getLocation())
        && pins.stream()
            .allMatch(
                pin ->
                    protection.sameLand(block.getLocation(), pin.getLocation())
                        && protection.mayOperateServerHistoricalCircuit(pin.getLocation())))
      return true;
    return owner.isPresent()
        && pins.stream()
            .allMatch(
                pin ->
                    protection.sameLand(block.getLocation(), pin.getLocation())
                        && protection
                            .check(
                                owner.orElseThrow(),
                                ProtectedAction.USE_REDSTONE,
                                pin.getLocation())
                            .isAllowed());
  }

  private void runFarm(Circuit circuit, UUID owner, boolean poll) {
    var block = circuit.block();
    var facing = ((WallSign) block.getBlockData()).getFacing();
    var visit =
        new CircuitAccess.Visit(
            block, circuit.sign(), facing, owner, poll, powered(circuit.inputs().getFirst()));
    switch (farms.run(circuit.tag().kind(), visit)) {
      case Result.Err<Optional<Boolean>, String>(var reason) -> problem(block, reason);
      case Result.Ok<Optional<Boolean>, String>(var output) -> {
        output.ifPresent(value -> setOutput(circuit, value));
        problems.remove(key(block));
      }
    }
  }

  private void runLogic(Circuit circuit, UUID actor, boolean poll) {
    var lines = PaperGrid.frontLines(circuit.sign());
    var kind = circuit.tag().kind();
    if ((kind == CircuitTag.Kind.TRANSMITTER || kind == CircuitTag.Kind.RECEIVER)
        && band(lines).isBlank()) {
      problem(circuit.block(), "wireless band must not be blank");
      return;
    }
    var output = outputLever(circuit);
    if (output.isEmpty() && kind != CircuitTag.Kind.TRANSMITTER) {
      problem(circuit.block(), "missing output lever attached to the IC support block");
      return;
    }
    // A transmitter still updates its wireless band without an output lever, as CraftBook did.
    desired(circuit, actor, poll, output.map(Switch::isPowered).orElse(false))
        .ifPresent(value -> setOutput(circuit, value));
    if (kind != CircuitTag.Kind.CLOCK) problems.remove(key(circuit.block()));
  }

  private Optional<Boolean> desired(Circuit circuit, UUID actor, boolean poll, boolean output) {
    var lines = PaperGrid.frontLines(circuit.sign());
    var input = powered(circuit.inputs().getFirst());
    return switch (circuit.tag().kind()) {
      case INVERTER -> Optional.of(!input);
      case AND -> {
        var wires = circuit.inputs().stream().filter(IntegratedCircuits::wire).toList();
        yield Optional.of(!wires.isEmpty() && wires.stream().allMatch(IntegratedCircuits::powered));
      }
      case TRANSMITTER -> {
        transmitters.put(key(circuit.block()), actor);
        yield Optional.of(wireless.transmit(band(lines), key(circuit.block()), input));
      }
      case RECEIVER ->
          poll
              ? wireless.receiveSelfTriggered(band(lines), source -> mayTransmit(source, circuit))
              : input
                  ? wireless.receive(
                      band(lines), false, true, source -> mayTransmit(source, circuit))
                  : Optional.empty();
      case CLOCK -> clock(circuit, input, output);
      default -> throw new IllegalStateException("farm circuit was not dispatched");
    };
  }

  private boolean mayTransmit(Key source, Circuit receiver) {
    var block = circuits.get(source);
    var actor = transmitters.get(source);
    if (block == null || actor == null) return false;
    var found = site(block);
    if (found.isEmpty()) return false;
    var sender = found.orElseThrow();
    var currentActor =
        kit.signs()
            .owner(sender.sign())
            .or(() -> protection.automationActor(block.getLocation()))
            .orElse(Protection.SERVER_AUTOMATION);
    if (sender.tag().kind() != CircuitTag.Kind.TRANSMITTER
        || !actor.equals(currentActor)
        || !band(PaperGrid.frontLines(sender.sign()))
            .equals(band(PaperGrid.frontLines(receiver.sign())))
        || sender.inputs().stream().anyMatch(pin -> !PaperGrid.loaded(pin))
        || !PaperGrid.loaded(sender.output())
        || !authorized(sender, Optional.of(actor))) return false;
    if (protection.sameLand(block.getLocation(), receiver.block().getLocation())
        && protection.mayOperateServerHistoricalCircuit(block.getLocation())
        && protection.mayOperateServerHistoricalCircuit(receiver.block().getLocation()))
      return true;
    var pins = new java.util.ArrayList<>(receiver.inputs());
    pins.add(receiver.block());
    pins.add(receiver.output());
    return pins.stream()
        .allMatch(
            pin ->
                protection
                    .check(actor, ProtectedAction.USE_REDSTONE, pin.getLocation())
                    .isAllowed());
  }

  private static Optional<Switch> outputLever(Circuit circuit) {
    if (circuit.output().getType() != Material.LEVER
        || !(circuit.output().getBlockData() instanceof Switch lever)
        || lever.getAttachedFace() != FaceAttachable.AttachedFace.WALL) return Optional.empty();
    var facing = ((WallSign) circuit.block().getBlockData()).getFacing();
    return circuit
            .output()
            .getRelative(lever.getFacing().getOppositeFace())
            .equals(circuit.block().getRelative(facing.getOppositeFace()))
        ? Optional.of(lever)
        : Optional.empty();
  }

  private void setOutput(Circuit circuit, boolean value) {
    outputLever(circuit)
        .ifPresent(
            lever -> {
              if (lever.isPowered() != value) {
                lever.setPowered(value);
                kit.changes().set("#storm-circuits", circuit.output(), lever, true);
              }
            });
  }

  private Optional<Boolean> clock(Circuit circuit, boolean disabled, boolean output) {
    if (disabled) return Optional.empty();
    var lines = PaperGrid.frontLines(circuit.sign());
    final int interval;
    final int count;
    try {
      interval = Integer.parseInt(lines.get(2));
      count = lines.get(3).isBlank() ? 0 : Integer.parseInt(lines.get(3));
    } catch (NumberFormatException error) {
      problem(circuit.block(), "clock interval and counter must be integers");
      return Optional.empty();
    }
    if (interval < 5 || interval > 500 || count < 0 || count >= interval) {
      problem(circuit.block(), "clock interval must be 5..500 and counter below the interval");
      return Optional.empty();
    }
    var next = (count + 1) % interval;
    circuit.sign().getSide(Side.FRONT).line(3, Component.text(Integer.toString(next)));
    if (!circuit.sign().update(false, false))
      throw new IllegalStateException("clock sign changed during its tick");
    problems.remove(key(circuit.block()));
    return next == 0 ? Optional.of(!output) : Optional.empty();
  }

  private void problem(Block block, String message) {
    if (!message.equals(problems.put(key(block), message)))
      context.logger().warn("Circuit {}: {}", key(block), message);
  }

  private static String band(List<String> lines) {
    return lines.get(2) + lines.get(3);
  }

  private static boolean wire(Block block) {
    return block.getType() == Material.REDSTONE_WIRE
        || block.getType() == Material.REPEATER
        || block.getType() == Material.LEVER;
  }

  private static boolean powered(Block block) {
    return block.getBlockData() instanceof Powerable power
        ? power.isPowered()
        : block.isBlockIndirectlyPowered() || block.getBlockPower() > 0;
  }

  private static Key key(Block block) {
    return new Key(block.getWorld().getUID(), block.getX(), block.getY(), block.getZ());
  }
}
