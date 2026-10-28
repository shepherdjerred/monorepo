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
import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateFrame;
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
  private final IdentityHashMap<SignChangeEvent, Stargate> pending = new IdentityHashMap<>();

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
    if (!enabled.getAsBoolean()) {
      reject(event, "Stargates are not available right now.");
      return;
    }
    if (!book.ready()) {
      reject(event, "Stargates are loading or saving; try again.");
      return;
    }
    var network = book.registry().network(lines.get(2).strip());
    if (network.isEmpty()) {
      reject(event, "Create the network first with /stargate network create.");
      return;
    }
    if (!access.mayCreate(event.getPlayer(), network.orElseThrow().access())) {
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
              network.orElseThrow().id(),
              lines.getFirst(),
              actor,
              block.getWorld().getUID(),
              sign,
              frame.orElseThrow());
      pending.put(event, gate);
    } catch (IllegalArgumentException error) {
      reject(event, "Choose a valid gate name on the first line.");
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void commit(SignChangeEvent event) {
    var gate = pending.remove(event);
    if (gate == null || event.isCancelled()) return;
    context.scheduler().runOnMainThread(() -> save(event, gate));
  }

  private void save(SignChangeEvent event, Stargate gate) {
    var player = event.getPlayer();
    if (event.isCancelled() || !player.isOnline() || !book.ready() || !enabled.getAsBoolean())
      return;
    var network = book.registry().network(gate.networkId());
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
          book.createGate(gate)
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
      player.sendMessage(
          Component.text("That Stargate overlaps another gate or its name is already in use."));
    }
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
