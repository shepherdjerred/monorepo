package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.world.BlockChanges;
import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.mechanics.app.StargateAccess;
import com.shepherdjerred.thestorm.mechanics.app.StargateBook;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.NetworkAccess;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import java.time.Duration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.Axis;
import org.bukkit.Material;
import org.bukkit.block.Sign;
import org.bukkit.block.data.Orientable;
import org.bukkit.block.sign.Side;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.EntityPortalEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerPortalEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.event.world.ChunkLoadEvent;
import org.bukkit.inventory.EquipmentSlot;

/** Sign selection, button activation and walk-in travel for player gates. */
final class StargatePortals implements Listener {
  private record Chunk(int x, int z) {}

  private record WorldChunk(org.bukkit.World world, int x, int z) {}

  private record OpenGate(Stargate gate, UUID target, Cancellable closing, Set<Chunk> chunks) {}

  private final ModuleContext context;
  private final StargateBook book;
  private final StargateAccess access;
  private final Protection protection;
  private final SealedWorlds sealed;
  private final BlockChanges blocks;
  private final ChunkTickets tickets;
  private final Duration openFor;
  private final java.util.function.BooleanSupplier enabled;
  private final StargateTravel travel;
  private final Map<UUID, UUID> selected = new HashMap<>();
  private final Map<UUID, OpenGate> active = new HashMap<>();
  private final Map<UUID, Set<WorldChunk>> destinationTickets = new HashMap<>();
  private final Set<UUID> loadingPermanent = new HashSet<>();
  private final Set<UUID> retryingPermanent = new HashSet<>();
  private final Set<UUID> inside = new HashSet<>();
  private final Cancellable permanentTick;
  private boolean stopped;

  StargatePortals(
      ModuleContext context, StargateBook book, StargateAccess access, StargateSettings settings) {
    this.context = context;
    this.book = book;
    this.access = access;
    this.openFor = settings.openFor();
    this.enabled = settings.enabled();
    this.protection = context.services().require(Protection.class);
    this.sealed = context.services().require(SealedWorlds.class);
    this.blocks = context.services().require(BlockChanges.class);
    this.tickets = context.services().require(ChunkTickets.class);
    this.travel = new StargateTravel(context, book, access, this::openAndIntact);
    this.permanentTick =
        context
            .scheduler()
            .repeatOnMainThread(
                Duration.ofSeconds(1), Duration.ofSeconds(1), this::reconcilePermanent);
  }

  private void reconcilePermanent() {
    if (stopped || !book.ready()) return;
    for (var entry : java.util.List.copyOf(active.values())) {
      if (entry.gate().alwaysOpen() && !permanentValid(entry.gate(), entry.target(), true)) {
        entry.closing().cancel();
        close(entry.gate().id());
      }
    }
    if (!enabled.getAsBoolean()) return;
    for (var gate : book.registry().gates()) reconcilePermanentGate(gate);
  }

  private void reconcilePermanentGate(Stargate gate) {
    if (!gate.alwaysOpen()
        || active.containsKey(gate.id())
        || loadingPermanent.contains(gate.id())
        || retryingPermanent.contains(gate.id())) return;
    var target = destination(gate);
    var sourceWorld = context.plugin().getServer().getWorld(gate.worldId());
    if (target.isEmpty() || sourceWorld == null || !intact(gate, false)) return;
    var targetWorld = context.plugin().getServer().getWorld(target.orElseThrow().worldId());
    if (targetWorld == null) return;
    loadPermanentTarget(gate, target.orElseThrow(), sourceWorld, targetWorld);
  }

  private void loadPermanentTarget(
      Stargate gate, Stargate target, org.bukkit.World sourceWorld, org.bukkit.World targetWorld) {
    var positions = new java.util.ArrayList<>(target.frame().frameBlocks());
    positions.addAll(target.frame().interior());
    positions.add(target.sign());
    positions.add(target.button());
    var chunks = new HashSet<WorldChunk>();
    positions.forEach(pos -> chunks.add(new WorldChunk(targetWorld, pos.x() >> 4, pos.z() >> 4)));
    loadingPermanent.add(gate.id());
    var loads =
        chunks.stream()
            .map(chunk -> chunk.world().getChunkAtAsync(chunk.x(), chunk.z()))
            .toArray(CompletableFuture<?>[]::new);
    var _ =
        CompletableFuture.allOf(loads)
            .whenCompleteAsync(
                (ignored, failure) -> {
                  loadingPermanent.remove(gate.id());
                  if (failure != null) {
                    context
                        .logger()
                        .error("Could not load destination for Stargate {}", gate.name(), failure);
                    retryPermanentLater(gate.id());
                    return;
                  }
                  if (stopped || !book.ready() || active.containsKey(gate.id())) return;
                  if (!permanentValid(gate, target.id(), false)) {
                    retryPermanentLater(gate.id());
                    return;
                  }
                  var held = new HashSet<WorldChunk>();
                  try {
                    for (var chunk : chunks) {
                      tickets.hold(chunk.world(), chunk.x(), chunk.z());
                      held.add(chunk);
                    }
                    openGate(gate, target, sourceWorld, true);
                    destinationTickets.put(gate.id(), Set.copyOf(held));
                  } catch (RuntimeException error) {
                    held.forEach(chunk -> tickets.release(chunk.world(), chunk.x(), chunk.z()));
                    context
                        .logger()
                        .error("Could not open permanent Stargate {}", gate.name(), error);
                    retryPermanentLater(gate.id());
                  }
                },
                context.scheduler().mainThread());
  }

  private void retryPermanentLater(UUID gateId) {
    if (stopped || !retryingPermanent.add(gateId)) return;
    context
        .scheduler()
        .runOnMainThreadLater(Duration.ofSeconds(5), () -> retryingPermanent.remove(gateId));
  }

  private boolean permanentValid(Stargate gate, UUID targetId, boolean open) {
    if (!enabled.getAsBoolean() || !book.ready()) return false;
    var registered = book.registry().gate(gate.id());
    var target = destination(gate);
    if (registered.isEmpty()
        || !registered.orElseThrow().equals(gate)
        || target.isEmpty()
        || !target.orElseThrow().id().equals(targetId)
        || !intact(gate, open)
        || !intact(target.orElseThrow(), active.containsKey(targetId))) return false;
    var world = context.plugin().getServer().getWorld(gate.worldId());
    var targetWorld = context.plugin().getServer().getWorld(target.orElseThrow().worldId());
    if (world == null
        || targetWorld == null
        || sealed.isSealed(world)
        || sealed.isSealed(targetWorld)) return false;
    var policy = book.registry().network(gate.networkId()).orElseThrow().access();
    if (!policy.permits(gate.ownerId(), town -> access.towns().isMember(gate.ownerId(), town)))
      return false;
    var grid = new PaperGrid(world);
    return gate.frame().interior().stream()
            .noneMatch(pos -> protection.isPreserved(grid.location(pos)))
        && new Guard(protection)
            .automaticCells(gate.ownerId(), grid, gate.frame().interior())
            .isAllowed();
  }

  boolean enabled() {
    return enabled.getAsBoolean();
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void interact(PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    if (block == null
        || event.getHand() != EquipmentSlot.HAND
        || event.getAction() != Action.RIGHT_CLICK_BLOCK
        || sealed.isSealed(block.getWorld())) return;
    var registry = book.committed();
    if (registry.isEmpty()) return;
    var pos = PaperGrid.pos(block);
    var sign = registry.orElseThrow().sign(block.getWorld().getUID(), pos);
    var button = registry.orElseThrow().button(block.getWorld().getUID(), pos);
    if (sign.isEmpty() && button.isEmpty()) return;
    event.setUseInteractedBlock(Event.Result.DENY);
    event.setUseItemInHand(Event.Result.DENY);
    var player = event.getPlayer();
    if (!enabled.getAsBoolean()) {
      tell(player, "Stargates are not available right now.");
      return;
    }
    if (!book.ready()) {
      tell(player, "Stargates are loading or saving; try again.");
      return;
    }
    var gate = sign.orElseGet(button::orElseThrow);
    if (!allowed(player, gate)
        || !protection
            .check(player.getUniqueId(), ProtectedAction.INTERACT, block.getLocation())
            .isAllowed()) {
      tell(player, "You cannot use this Stargate.");
      return;
    }
    if (sign.isPresent()) select(player, gate);
    else activate(player, gate);
  }

  private void select(Player player, Stargate gate) {
    if (gate.fixedDestination() != null) {
      tell(
          player,
          "Fixed destination: " + gate.fixedDestination() + ". Press the button to open the gate.");
      return;
    }
    if (active.containsKey(gate.id())) {
      tell(player, "Wait for this Stargate to close before changing its destination.");
      return;
    }
    if (!intact(gate, false)) {
      tell(player, "This Stargate's frame, sign or button has changed.");
      return;
    }
    var destinations = book.registry().destinations(gate);
    if (destinations.isEmpty()) {
      tell(player, "There are no other Stargates on this network yet.");
      return;
    }
    var chosen = selected.get(gate.id());
    var next = 0;
    for (var i = 0; i < destinations.size(); i++) {
      if (destinations.get(i).id().equals(chosen)) next = (i + 1) % destinations.size();
    }
    var destination = destinations.get(next);
    selected.put(gate.id(), destination.id());
    var world = context.plugin().getServer().getWorld(gate.worldId());
    if (world != null) {
      var grid = new PaperGrid(world);
      var signBlock = grid.block(gate.sign());
      if (!protection.isPreserved(signBlock.getLocation())
          && new Guard(protection)
              .automaticCells(gate.ownerId(), grid, java.util.List.of(gate.sign()))
              .isAllowed()
          && signBlock.getState() instanceof Sign sign) {
        sign.getSide(Side.FRONT).line(1, Component.text(destination.name()));
        sign.update();
      }
    }
    tell(player, "Destination: " + destination.name() + ". Press the button to open the gate.");
  }

  private void activate(Player player, Stargate gate) {
    if (active.containsKey(gate.id())) return;
    if (gate.alwaysOpen()) {
      tell(player, "This gate opens automatically when its destination is available.");
      return;
    }
    var target = destination(gate);
    if (target.isEmpty() || !gate.networkId().equals(target.orElseThrow().networkId())) {
      tell(player, "Select a destination on the sign first.");
      return;
    }
    if (!intact(gate, false)) {
      tell(player, "This Stargate's frame, sign or button has changed.");
      return;
    }
    var world = context.plugin().getServer().getWorld(gate.worldId());
    if (world == null) return;
    var grid = new PaperGrid(world);
    if (!new Guard(protection)
        .automaticCells(gate.ownerId(), grid, gate.frame().interior())
        .isAllowed()) {
      tell(player, "This Stargate no longer has permission to change its portal.");
      return;
    }
    openGate(gate, target.orElseThrow(), world, false);
    tell(player, "Stargate open to " + target.orElseThrow().name() + ".");
  }

  private void openGate(Stargate gate, Stargate target, org.bukkit.World world, boolean permanent) {
    var grid = new PaperGrid(world);
    var data = (Orientable) Material.NETHER_PORTAL.createBlockData();
    data.setAxis(gate.frame().across().dx() == 0 ? Axis.Z : Axis.X);
    var updates =
        gate.frame().interior().stream()
            .map(pos -> new BlockChanges.Update(grid.block(pos), data, false))
            .toList();
    var chunks = new HashSet<Chunk>();
    gate.frame().interior().forEach(pos -> chunks.add(new Chunk(pos.x() >> 4, pos.z() >> 4)));
    gate.frame().frameBlocks().forEach(pos -> chunks.add(new Chunk(pos.x() >> 4, pos.z() >> 4)));
    chunks.add(new Chunk(gate.sign().x() >> 4, gate.sign().z() >> 4));
    chunks.add(new Chunk(gate.button().x() >> 4, gate.button().z() >> 4));
    var held = new HashSet<Chunk>();
    try {
      for (var chunk : chunks) {
        tickets.hold(world, chunk.x(), chunk.z());
        held.add(chunk);
      }
      Cancellable closing =
          permanent
              ? () -> {}
              : context.scheduler().runOnMainThreadLater(openFor, () -> close(gate.id()));
      try {
        blocks.prepare("stargate", updates).apply();
        active.put(gate.id(), new OpenGate(gate, target.id(), closing, Set.copyOf(chunks)));
      } catch (RuntimeException failure) {
        StargateActivation.abort(closing, () -> removePortal(gate, grid), failure);
        throw failure;
      }
    } catch (RuntimeException error) {
      for (var chunk : held) tickets.release(world, chunk.x(), chunk.z());
      throw error;
    }
  }

  private java.util.Optional<Stargate> destination(Stargate gate) {
    if (gate.fixedDestination() != null)
      return book.registry().gate(gate.networkId(), gate.fixedDestination());
    var targetId = selected.get(gate.id());
    return targetId == null ? java.util.Optional.empty() : book.registry().gate(targetId);
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void move(PlayerMoveEvent event) {
    if (!event.hasChangedBlock()) return;
    enter(event.getPlayer(), event.getTo());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void vehicleMove(org.bukkit.event.vehicle.VehicleMoveEvent event) {
    var vehicle = event.getVehicle();
    if (!StargateMount.supported(vehicle)) return;
    var position =
        StargateMount.touchingPortal(vehicle, event.getTo(), this::isGate).orElseGet(event::getTo);
    for (var passenger : vehicle.getPassengers())
      if (passenger instanceof Player player) enter(player, position);
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void mountMove(io.papermc.paper.event.entity.EntityMoveEvent event) {
    var mount = event.getEntity();
    if (!event.hasChangedPosition() || !StargateMount.supported(mount)) return;
    var position =
        StargateMount.touchingPortal(mount, event.getTo(), this::isGate).orElseGet(event::getTo);
    for (var passenger : mount.getPassengers())
      if (passenger instanceof Player player) enter(player, position);
  }

  private void enter(Player player, org.bukkit.Location to) {
    var registry = book.committed();
    var gate = registry.flatMap(value -> value.interior(to.getWorld().getUID(), PaperGrid.pos(to)));
    var id = player.getUniqueId();
    if (gate.isEmpty()) {
      inside.remove(id);
      return;
    }
    if (!inside.add(id) || !book.ready() || !enabled.getAsBoolean()) return;
    var entry = active.get(gate.orElseThrow().id());
    if (entry == null) return;
    var target = book.registry().gate(entry.target());
    if (target.isPresent()) travel.go(player, entry.gate(), target.orElseThrow());
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void playerPortal(PlayerPortalEvent event) {
    var vehicle = event.getPlayer().getVehicle();
    if (isGate(event.getFrom())
        || isGate(event.getFrom().clone().add(0, 1, 0))
        || (vehicle != null
            && StargateMount.touchingPortal(vehicle, event.getFrom(), this::isGate).isPresent()))
      event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void entityPortal(EntityPortalEvent event) {
    if (isGate(event.getFrom())
        || isGate(event.getFrom().clone().add(0, 1, 0))
        || StargateMount.touchingPortal(event.getEntity(), event.getFrom(), this::isGate)
            .isPresent()) event.setCancelled(true);
  }

  @EventHandler
  void quit(PlayerQuitEvent event) {
    inside.remove(event.getPlayer().getUniqueId());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void teleported(PlayerTeleportEvent event) {
    inside.remove(event.getPlayer().getUniqueId());
  }

  /** Recover portals left open by a crash once their blocks are loaded. */
  @EventHandler
  void chunkLoaded(ChunkLoadEvent event) {
    var chunk = event.getChunk();
    context
        .scheduler()
        .runOnMainThread(
            () ->
                book.committed()
                    .ifPresent(
                        registry ->
                            registry.gates().stream()
                                .filter(gate -> gate.worldId().equals(chunk.getWorld().getUID()))
                                .filter(gate -> touchesChunk(gate, chunk.getX(), chunk.getZ()))
                                .forEach(this::recover)));
  }

  void reconcileLoaded() {
    book.committed().ifPresent(registry -> registry.gates().forEach(this::recover));
  }

  boolean canRemove(Stargate gate) {
    if (active.containsKey(gate.id())) return false;
    var world = context.plugin().getServer().getWorld(gate.worldId());
    if (world == null) return false;
    var grid = new PaperGrid(world);
    return gate.frame().interior().stream()
        .allMatch(pos -> grid.loaded(pos) && !grid.cellAt(pos).is("minecraft:nether_portal"));
  }

  /** Close an active gate before its durable removal; fail if portal blocks remain. */
  boolean closeForRemoval(Stargate gate) {
    var open = active.get(gate.id());
    if (open != null) {
      open.closing().cancel();
      close(gate.id());
    }
    recover(gate);
    return canRemove(gate);
  }

  CompletableFuture<Void> resetPlayer(UUID player) {
    if (!book.ready())
      return CompletableFuture.failedFuture(
          new IllegalStateException("Stargates are not ready for reset"));
    var registry = book.registry();
    var affected =
        registry.gates().stream()
            .filter(
                gate ->
                    gate.ownerId().equals(player)
                        || (registry.network(gate.networkId()).orElseThrow().access()
                                instanceof NetworkAccess.Private(var owner, _)
                            && owner.equals(player)))
            .toList();
    var chunks = new HashSet<WorldChunk>();
    for (var gate : affected) {
      var world = context.plugin().getServer().getWorld(gate.worldId());
      if (world == null)
        return CompletableFuture.failedFuture(
            new IllegalStateException("Stargate world is not loaded"));
      var positions = new java.util.ArrayList<>(gate.frame().frameBlocks());
      positions.addAll(gate.frame().interior());
      positions.add(gate.sign());
      positions.add(gate.button());
      positions.forEach(pos -> chunks.add(new WorldChunk(world, pos.x() >> 4, pos.z() >> 4)));
    }
    var loads =
        chunks.stream()
            .map(chunk -> chunk.world().getChunkAtAsync(chunk.x(), chunk.z()))
            .toArray(CompletableFuture<?>[]::new);
    return CompletableFuture.allOf(loads)
        .thenComposeAsync(
            ignored -> finishReset(player, registry, affected, chunks),
            context.scheduler().mainThread());
  }

  private CompletableFuture<Void> finishReset(
      UUID player,
      com.shepherdjerred.thestorm.mechanics.app.StargateRegistry registry,
      java.util.List<Stargate> affected,
      Set<WorldChunk> chunks) {
    if (!book.ready() || book.registry() != registry)
      return CompletableFuture.failedFuture(
          new IllegalStateException("Stargates changed during reset"));
    var held = new java.util.ArrayList<WorldChunk>();
    try {
      for (var chunk : chunks) {
        tickets.hold(chunk.world(), chunk.x(), chunk.z());
        held.add(chunk);
      }
      for (var gate : affected) {
        var open = active.get(gate.id());
        if (open != null) {
          open.closing().cancel();
          close(gate.id());
        }
        recover(gate);
        if (!canRemove(gate))
          throw new IllegalStateException("Stargate could not be safely closed: " + gate.name());
      }
      return book.resetPlayer(player)
          .whenCompleteAsync(
              (done, failure) -> releaseResetChunks(held), context.scheduler().mainThread());
    } catch (RuntimeException failure) {
      releaseResetChunks(held);
      return CompletableFuture.failedFuture(failure);
    }
  }

  private void releaseResetChunks(java.util.List<WorldChunk> chunks) {
    for (var chunk : chunks) tickets.release(chunk.world(), chunk.x(), chunk.z());
  }

  private void recover(Stargate gate) {
    if (active.containsKey(gate.id())) return;
    var world = context.plugin().getServer().getWorld(gate.worldId());
    var network = book.committed().flatMap(registry -> registry.network(gate.networkId()));
    if (world == null || network.isEmpty()) return;
    var grid = new PaperGrid(world);
    if (StargateIntegrity.recoverable(grid, gate, network.orElseThrow())) removePortal(gate, grid);
  }

  private static boolean touchesChunk(Stargate gate, int chunkX, int chunkZ) {
    var positions = new java.util.ArrayList<>(gate.frame().frameBlocks());
    positions.addAll(gate.frame().interior());
    positions.add(gate.sign());
    positions.add(gate.button());
    return positions.stream().anyMatch(pos -> pos.x() >> 4 == chunkX && pos.z() >> 4 == chunkZ);
  }

  private boolean isGate(org.bukkit.Location position) {
    // Stored gates cannot be distinguished from vanilla portals until the registry loads.
    if (book.committed().isEmpty()) return true;
    return book.committed()
        .flatMap(
            registry -> registry.interior(position.getWorld().getUID(), PaperGrid.pos(position)))
        .isPresent();
  }

  private boolean allowed(Player player, Stargate gate) {
    return book.registry()
        .network(gate.networkId())
        .map(network -> access.mayUse(player, network.access()))
        .orElse(false);
  }

  private boolean intact(Stargate gate, boolean open) {
    var world = context.plugin().getServer().getWorld(gate.worldId());
    var network = book.committed().flatMap(registry -> registry.network(gate.networkId()));
    return world != null
        && network.isPresent()
        && StargateIntegrity.valid(new PaperGrid(world), gate, network.orElseThrow(), open);
  }

  private boolean openAndIntact(Stargate gate) {
    return enabled.getAsBoolean() && active.containsKey(gate.id()) && intact(gate, true);
  }

  private void close(UUID id) {
    var entry = active.remove(id);
    if (entry == null) return;
    var gate = entry.gate();
    var world = context.plugin().getServer().getWorld(gate.worldId());
    try {
      if (world != null) removePortal(gate, new PaperGrid(world));
    } finally {
      if (world != null)
        for (var chunk : entry.chunks()) tickets.release(world, chunk.x(), chunk.z());
      var destination = destinationTickets.remove(id);
      if (destination != null)
        destination.forEach(chunk -> tickets.release(chunk.world(), chunk.x(), chunk.z()));
    }
  }

  private void removePortal(Stargate gate, PaperGrid grid) {
    var portal =
        gate.frame().interior().stream()
            .filter(pos -> grid.loaded(pos) && grid.cellAt(pos).is("minecraft:nether_portal"))
            .toList();
    if (portal.isEmpty()) return;
    if (portal.stream().anyMatch(pos -> protection.isPreserved(grid.location(pos)))
        || !new Guard(protection).automaticCells(gate.ownerId(), grid, portal).isAllowed()) {
      context.logger().error("Stargate {} could not close due to land protection", gate.name());
      return;
    }
    var air = Material.AIR.createBlockData();
    blocks
        .prepare(
            "stargate",
            portal.stream()
                .map(pos -> new BlockChanges.Update(grid.block(pos), air, false))
                .toList())
        .apply();
  }

  void stop() {
    stopped = true;
    permanentTick.cancel();
    for (var entry : java.util.List.copyOf(active.values())) {
      entry.closing().cancel();
      close(entry.gate().id());
    }
  }

  private static void tell(Player player, String message) {
    player.sendMessage(Component.text(message));
  }
}
