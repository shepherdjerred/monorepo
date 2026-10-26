package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.world.ArenaSessions;
import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqReturnCharges;
import com.shepherdjerred.thestorm.essentials.app.TeleportTravel;
import java.util.HashMap;
import java.util.Map;
import java.util.OptionalInt;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.inventory.EquipmentSlot;

/**
 * The first five deaths outside sealed worlds and arenas leave a Return compass. Using it is free
 * and immediate. The next death brings a new one with one fewer charge, whether or not this one was
 * used.
 */
final class ReturnListener implements Listener {
  private final ModuleContext context;
  private final PaperRuntime runtime;
  private final JooqReturnCharges charges;
  private final TeleportTravel travel;
  private final Map<UUID, OptionalInt> known = new HashMap<>();
  private final Map<UUID, Pending> pending = new HashMap<>();

  private record Pending(Location death, int shown) {}

  ReturnListener(
      ModuleContext context,
      PaperRuntime runtime,
      JooqReturnCharges charges,
      TeleportTravel travel) {
    this.context = context;
    this.runtime = runtime;
    this.charges = charges;
    this.travel = travel;
  }

  @EventHandler
  void onJoin(org.bukkit.event.player.PlayerJoinEvent event) {
    if (!Humans.isHuman(event.getPlayer())) return;
    var player = event.getPlayer();
    runtime.onMain(
        charges.read(player.getUniqueId()),
        "reading return charges",
        stored -> known.put(player.getUniqueId(), stored));
  }

  @EventHandler
  void onQuit(org.bukkit.event.player.PlayerQuitEvent event) {
    known.remove(event.getPlayer().getUniqueId());
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onDeath(PlayerDeathEvent event) {
    if (!Humans.isHuman(event.getEntity())) return;
    var player = event.getEntity();
    event.getDrops().removeIf(ReturnToken::marked);
    if (context.services().require(SealedWorlds.class).isSealed(player.getWorld())) return;
    if (context
        .services()
        .find(ArenaSessions.class)
        .map(arenas -> arenas.contains(player.getUniqueId()))
        .orElse(false)) return;
    var id = player.getUniqueId();
    var death = Positions.current(player).clone();
    var stored = known.get(id);
    if (stored == null) {
      runtime.onMain(
          charges.read(id), "reading return charges", loaded -> grant(player, death, loaded));
      return;
    }
    grant(player, death, stored);
  }

  private void grant(Player player, Location death, OptionalInt stored) {
    var shown = stored.isEmpty() ? ReturnToken.FIRST_DEATHS : stored.getAsInt();
    if (shown <= 0 || death.getWorld() == null) return;
    var next = shown - 1;
    known.put(player.getUniqueId(), OptionalInt.of(next));
    runtime.logFailure(charges.write(player.getUniqueId(), next), "saving return charges");
    pending.put(player.getUniqueId(), new Pending(death, shown));
    if (player.isOnline() && !player.isDead()) place(player);
  }

  @EventHandler
  void onRespawn(PlayerRespawnEvent event) {
    place(event.getPlayer());
  }

  private void place(Player player) {
    var waiting = pending.remove(player.getUniqueId());
    if (waiting == null || !player.isOnline()) return;
    ReturnToken.place(player, ReturnToken.item(player, waiting.death(), waiting.shown()));
  }

  @EventHandler
  void onDrop(PlayerDropItemEvent event) {
    if (ReturnToken.marked(event.getItemDrop().getItemStack())) event.setCancelled(true);
  }

  @EventHandler
  void onUse(PlayerInteractEvent event) {
    if (event.getHand() != EquipmentSlot.HAND || !ReturnToken.marked(event.getItem())) return;
    if (!event.getAction().isRightClick() && !event.getAction().isLeftClick()) return;
    event.setCancelled(true);
    var player = event.getPlayer();
    var item = event.getItem();
    if (item == null) return;
    var destination = ReturnToken.destination(runtime.server(), item);
    if (destination.isEmpty()) {
      Say.error(player, Say.TELEPORT, "That return has no destination.");
      return;
    }
    var target = destination.orElseThrow();
    travel.complimentary(player, "where you died", () -> prepareReturn(player, target));
  }

  private CompletableFuture<Result<TeleportTravel.Landing, Component>> prepareReturn(
      Player player, Location target) {
    var ready = new CompletableFuture<Result<TeleportTravel.Landing, Component>>();
    if (SafeLocations.isLoaded(target)) {
      ready.complete(returnLanding(player, target));
      return ready;
    }
    var world = target.getWorld();
    if (world == null) {
      ready.complete(Result.err(Component.text("That return has no destination.")));
      return ready;
    }
    runtime.onMain(
        world.getChunkAtAsync(target),
        "loading the return destination",
        chunk -> ready.complete(returnLanding(player, target)),
        failure ->
            ready.complete(Result.err(Component.text("Couldn't load where you died. Try again."))));
    return ready;
  }

  private Result<TeleportTravel.Landing, Component> returnLanding(Player player, Location target) {
    if (!player.isOnline()) {
      return Result.err(Component.text("You left before the return."));
    }
    var safe = SafeLocations.nearestSafe(target);
    if (safe.isEmpty()) {
      return Result.err(Component.text("Couldn't find a safe spot. Try again."));
    }
    var spot = safe.orElseThrow();
    var world = spot.getWorld();
    if (world == null) {
      return Result.err(Component.text("That return has no destination."));
    }
    var tickets = context.services().require(ChunkTickets.class);
    var chunkX = spot.getBlockX() >> 4;
    var chunkZ = spot.getBlockZ() >> 4;
    tickets.hold(world, chunkX, chunkZ);
    return Result.ok(
        new TeleportTravel.Landing(
            spot, () -> tickets.release(world, chunkX, chunkZ), () -> ReturnToken.remove(player)));
  }
}
