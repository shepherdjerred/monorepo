package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.mechanics.app.StargateAccess;
import com.shepherdjerred.thestorm.mechanics.app.StargateBook;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Mount;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.NetworkAccess;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateFrame;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateNetwork;
import java.util.IdentityHashMap;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.block.sign.Side;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.SignChangeEvent;

/** Binds a sign to an intact frame after its write is accepted by every other listener. */
final class StargateCreation implements Listener {
  private final ModuleContext context;
  private final StargateBook book;
  private final StargateAccess access;
  private final Protection protection;
  private final SealedWorlds sealed;
  private final java.util.function.BooleanSupplier enabled;

  private record Pending(Stargate gate, StargateNetwork network, boolean newNetwork) {}

  private record NetworkChoice(StargateNetwork network, boolean created) {}

  private final IdentityHashMap<SignChangeEvent, Pending> pending = new IdentityHashMap<>();

  StargateCreation(
      ModuleContext context,
      StargateBook book,
      StargateAccess access,
      java.util.function.BooleanSupplier enabled) {
    this.context = context;
    this.book = book;
    this.access = access;
    this.enabled = enabled;
    this.protection = context.services().require(Protection.class);
    this.sealed = context.services().require(SealedWorlds.class);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void prepare(SignChangeEvent event) {
    if (event.getSide() != Side.FRONT || sealed.isSealed(event.getBlock().getWorld())) return;
    var lines = event.lines().stream().map(PaperGrid::plain).toList();
    var block = event.getBlock();
    var grid = new PaperGrid(block.getWorld());
    var view = PaperGrid.view(block, lines);
    if (view.mount() != Mount.WALL || view.facing().isEmpty()) return;
    var sign = PaperGrid.pos(block);
    if (book.committed()
        .flatMap(registry -> registry.sign(block.getWorld().getUID(), sign))
        .isPresent()) {
      reject(event, "Remove the existing Stargate before changing its sign.");
      return;
    }
    var facing = view.facing().orElseThrow();
    var frame = StargateFrame.find(grid, sign, facing);
    if (frame.isEmpty()) return;
    var option = lines.get(3).strip();
    if (!available(event, option)) return;
    var choice = networkChoice(event, lines.get(2));
    if (choice.isEmpty()) return;
    var network = choice.orElseThrow().network();
    if (!access.mayCreate(event.getPlayer(), network.access())) {
      reject(event, "You need Mechanic III and access to this network.");
      return;
    }
    if (!hasButton(grid, sign, facing, frame.orElseThrow())) {
      reject(event, "Put a wall button on the other side of the Stargate frame.");
      return;
    }
    var cells = new java.util.ArrayList<>(frame.orElseThrow().frameBlocks());
    cells.addAll(frame.orElseThrow().interior());
    cells.add(sign);
    var support = sign.offset(facing.opposite());
    cells.add(
        frame.orElseThrow().controls().stream()
            .filter(pos -> !pos.equals(support))
            .findFirst()
            .orElseThrow()
            .offset(facing));
    var actor = event.getPlayer().getUniqueId();
    if (!mayBuild(actor, grid, sign, cells)) {
      reject(event, "You need permission to build across the whole Stargate.");
      return;
    }
    try {
      var id = new UUID(context.random().nextLong(), context.random().nextLong());
      var gate =
          new Stargate(
              id,
              network.id(),
              lines.getFirst(),
              actor,
              block.getWorld().getUID(),
              sign,
              frame.orElseThrow(),
              lines.get(1).isBlank() ? null : lines.get(1).strip(),
              option.equalsIgnoreCase("A"));
      if (lines.get(2).isBlank()) event.line(2, Component.text(network.name()));
      pending.put(event, new Pending(gate, network, choice.orElseThrow().created()));
    } catch (IllegalArgumentException error) {
      reject(event, "Use valid gate and destination names; A requires a fixed destination.");
    }
  }

  private boolean available(SignChangeEvent event, String option) {
    if (!enabled.getAsBoolean()) {
      reject(event, "Stargates are not available right now.");
      return false;
    }
    if (!book.ready()) {
      reject(event, "Stargates are loading or saving; try again.");
      return false;
    }
    if (!validOption(event, option)) return false;
    if (option.equalsIgnoreCase("A")
        && !book.canCreateAlwaysOpen(event.getPlayer().getUniqueId())) {
      reject(event, "You can own at most four always-open Stargates.");
      return false;
    }
    return true;
  }

  private static boolean validOption(SignChangeEvent event, String option) {
    if (option.isEmpty() || option.equalsIgnoreCase("A")) return true;
    reject(event, "Leave line four blank or use A for an always-open gate.");
    return false;
  }

  private java.util.Optional<NetworkChoice> networkChoice(SignChangeEvent event, String line) {
    var name = line.isBlank() ? "central" : line.strip();
    var existing = book.registry().network(name);
    if (existing.isPresent())
      return java.util.Optional.of(new NetworkChoice(existing.orElseThrow(), false));
    try {
      var network =
          new StargateNetwork(
              new UUID(context.random().nextLong(), context.random().nextLong()),
              name,
              new NetworkAccess.Public());
      return java.util.Optional.of(new NetworkChoice(network, true));
    } catch (IllegalArgumentException error) {
      reject(event, "Choose a valid network name on the third line.");
      return java.util.Optional.empty();
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void commit(SignChangeEvent event) {
    var creation = pending.remove(event);
    if (creation == null || event.isCancelled()) return;
    context.scheduler().runOnMainThread(() -> save(event, creation));
  }

  private void save(SignChangeEvent event, Pending creation) {
    var gate = creation.gate();
    var player = event.getPlayer();
    if (event.isCancelled() || !player.isOnline() || !book.ready() || !enabled.getAsBoolean())
      return;
    var network =
        creation.newNetwork()
            ? java.util.Optional.of(creation.network())
            : book.registry().network(gate.networkId());
    var grid = new PaperGrid(event.getBlock().getWorld());
    if (network.isEmpty()
        || !access.mayCreate(player, network.orElseThrow().access())
        || sealed.isSealed(grid.world())
        || !StargateIntegrity.valid(grid, gate, network.orElseThrow(), false)) {
      player.sendMessage(Component.text("The Stargate changed before it could be saved."));
      return;
    }
    var cells = new java.util.ArrayList<>(gate.frame().frameBlocks());
    cells.addAll(gate.frame().interior());
    cells.add(gate.sign());
    cells.add(gate.button());
    if (!mayBuild(gate.ownerId(), grid, gate.sign(), cells)) {
      player.sendMessage(Component.text("You can no longer build across the whole Stargate."));
      return;
    }
    try {
      var _ =
          (creation.newNetwork()
                  ? book.createNetworkAndGate(creation.network(), gate)
                  : book.createGate(gate))
              .whenCompleteAsync(
                  (ignored, failure) -> {
                    if (failure != null) {
                      context.logger().error("Could not save Stargate {}", gate.name(), failure);
                      if (player.isOnline())
                        player.sendMessage(Component.text("Could not save your Stargate."));
                    } else if (player.isOnline()) {
                      player.sendMessage(Component.text("Stargate " + gate.name() + " created."));
                    }
                  },
                  context.scheduler().mainThread());
    } catch (IllegalArgumentException | IllegalStateException failure) {
      player.sendMessage(Component.text(creationFailure(failure)));
    }
  }

  private static String creationFailure(RuntimeException failure) {
    if (failure instanceof StargateBook.AlwaysOpenLimitException)
      return "You can own at most four always-open Stargates.";
    return "That Stargate overlaps another gate or its name is already in use.";
  }

  private boolean mayBuild(UUID actor, PaperGrid grid, Pos sign, java.util.List<Pos> cells) {
    return cells.stream()
        .allMatch(
            pos ->
                protection.sameLand(grid.location(sign), grid.location(pos))
                    && protection
                        .check(actor, ProtectedAction.BUILD, grid.location(pos))
                        .isAllowed());
  }

  private static boolean hasButton(
      PaperGrid grid, Pos sign, Direction facing, StargateFrame frame) {
    var support = sign.offset(facing.opposite());
    var other =
        frame.controls().stream().filter(pos -> !pos.equals(support)).findFirst().orElseThrow();
    if (!grid.contains(other.offset(facing)) || !grid.loaded(other.offset(facing))) return false;
    return StargateIntegrity.button(grid, other.offset(facing), facing);
  }

  private static void reject(SignChangeEvent event, String reason) {
    event.setCancelled(true);
    event.getPlayer().sendMessage(Component.text(reason));
  }
}
