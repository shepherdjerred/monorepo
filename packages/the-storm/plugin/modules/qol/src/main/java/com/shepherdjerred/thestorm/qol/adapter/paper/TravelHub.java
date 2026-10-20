package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.mojang.brigadier.Command;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.essentials.app.TeleportTravel;
import com.shepherdjerred.thestorm.qol.domain.travel.HubPoint;
import com.shepherdjerred.thestorm.qol.domain.travel.TravelConfig;
import com.shepherdjerred.thestorm.qol.domain.travel.TravelDestination;
import com.shepherdjerred.thestorm.world.app.WildWorlds;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.dialog.Dialog;
import io.papermc.paper.registry.data.dialog.ActionButton;
import io.papermc.paper.registry.data.dialog.DialogBase;
import io.papermc.paper.registry.data.dialog.action.DialogAction;
import io.papermc.paper.registry.data.dialog.body.DialogBody;
import io.papermc.paper.registry.data.dialog.type.DialogType;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickCallback;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityPortalEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerPortalEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/**
 * The travel hub at the main spawn: Stargate-style walk-in gates and {@code /worlds}. A wilderness
 * destination is a random teleport; any other arrives at its world's spawn as a warp. Essentials
 * owns the travel policy for both.
 */
final class TravelHub implements Listener {

  private final ModuleContext context;
  private final TravelConfig config;
  private final RtpFlow flow;
  private final TeleportTravel travel;
  private final ChunkTickets tickets;
  private final SealedWorlds sealed;
  private final Dialog dialog;
  private final Map<UUID, String> inside = new HashMap<>();

  TravelHub(ModuleContext context, TravelConfig config, RtpFlow flow) {
    this.context = context;
    this.config = config;
    this.flow = flow;
    this.travel = context.services().require(TeleportTravel.class);
    this.tickets = context.services().require(ChunkTickets.class);
    this.sealed = context.services().require(SealedWorlds.class);
    validate(context, config);
    this.dialog = dialog(config);
  }

  void register(Commands commands) {
    commands.register(
        Commands.literal("worlds")
            .executes(
                command -> {
                  if (command.getSource().getSender() instanceof Player player) {
                    player.showDialog(dialog);
                  } else {
                    command
                        .getSource()
                        .getSender()
                        .sendMessage(Messages.error("Only players can do that."));
                  }
                  return Command.SINGLE_SUCCESS;
                })
            .build(),
        "Travel to another world");
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onMove(PlayerMoveEvent event) {
    if (!event.hasChangedBlock()) {
      return;
    }
    var player = event.getPlayer();
    var to = event.getTo();
    var portal =
        config.portalAt(
            to.getWorld().getName(), new HubPoint(to.getBlockX(), to.getBlockY(), to.getBlockZ()));
    if (portal.isEmpty()) {
      inside.remove(player.getUniqueId());
      return;
    }
    var id = portal.get().id();
    if (id.equals(inside.put(player.getUniqueId(), id))) {
      return;
    }
    go(player, portal.get());
  }

  /** Gates are framed with portal blocks; standing in one never starts a vanilla portal trip. */
  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  public void onPortal(PlayerPortalEvent event) {
    if (inGate(event.getFrom())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  public void onEntityPortal(EntityPortalEvent event) {
    if (inGate(event.getFrom())) {
      event.setCancelled(true);
    }
  }

  private boolean inGate(Location at) {
    return config
        .portalAt(
            at.getWorld().getName(), new HubPoint(at.getBlockX(), at.getBlockY(), at.getBlockZ()))
        .isPresent();
  }

  @EventHandler
  public void onQuit(PlayerQuitEvent event) {
    inside.remove(event.getPlayer().getUniqueId());
  }

  private void go(Player player, TravelDestination destination) {
    if (destination.random()) {
      flow.start(player, destination.world(), Optional.empty());
      return;
    }
    if (sealed.isSealed(player.getWorld())) {
      player.sendMessage(Messages.error("You can't travel out of this world."));
      return;
    }
    var world = loaded(context, destination.world());
    travel.warp(player, destination.label(), () -> spawnLanding(world));
  }

  private CompletableFuture<Result<TeleportTravel.Landing, Component>> spawnLanding(World world) {
    var spawn = world.getSpawnLocation();
    var chunkX = spawn.getBlockX() >> 4;
    var chunkZ = spawn.getBlockZ() >> 4;
    return world
        .getChunkAtAsync(chunkX, chunkZ)
        .thenApplyAsync(
            chunk -> {
              tickets.hold(world, chunkX, chunkZ);
              return Result.<TeleportTravel.Landing, Component>ok(
                  new TeleportTravel.Landing(
                      new Location(
                          world,
                          spawn.getBlockX() + 0.5,
                          spawn.getY(),
                          spawn.getBlockZ() + 0.5,
                          spawn.getYaw(),
                          spawn.getPitch()),
                      () -> tickets.release(world, chunkX, chunkZ),
                      () -> {}));
            },
            context.scheduler().mainThread());
  }

  private Dialog dialog(TravelConfig config) {
    var options =
        ClickCallback.Options.builder()
            .uses(ClickCallback.UNLIMITED_USES)
            .lifetime(Duration.ofDays(3650))
            .build();
    var buttons = new ArrayList<ActionButton>();
    for (var destination : config.destinations()) {
      buttons.add(
          ActionButton.create(
              Component.text(destination.label()),
              Component.text(destination.description()),
              150,
              DialogAction.customClick(
                  (view, audience) -> {
                    if (audience instanceof Player player) {
                      player.closeDialog();
                      go(player, destination);
                    }
                  },
                  options)));
    }
    var primary = config.destinations().getFirst().label();
    return Dialog.create(
        factory ->
            factory
                .empty()
                .base(
                    DialogBase.builder(Component.text("Travel"))
                        .canCloseWithEscape(true)
                        .pause(false)
                        .body(
                            List.of(
                                DialogBody.plainMessage(
                                    Component.text(
                                        primary
                                            + " is where most survival happens. /spawn always"
                                            + " brings you back to the main spawn."))))
                        .build())
                .type(
                    DialogType.multiAction(buttons)
                        .columns(2)
                        .exitAction(ActionButton.builder(Component.text("Stay")).build())
                        .build()));
  }

  private static void validate(ModuleContext context, TravelConfig config) {
    loaded(context, config.hubWorld());
    var worlds = context.services().require(WildWorlds.class);
    for (var destination : config.destinations()) {
      loaded(context, destination.world());
      if (destination.random()) {
        var wild = worlds.named(destination.world());
        if (wild.isEmpty() || !wild.get().rtp()) {
          throw new IllegalStateException(
              "travel destination " + destination.id() + " is not a random-teleport world");
        }
      }
    }
  }

  private static World loaded(ModuleContext context, String name) {
    var world = context.plugin().getServer().getWorld(name);
    if (world == null) {
      throw new IllegalStateException("travel world " + name + " is not loaded");
    }
    return world;
  }
}
