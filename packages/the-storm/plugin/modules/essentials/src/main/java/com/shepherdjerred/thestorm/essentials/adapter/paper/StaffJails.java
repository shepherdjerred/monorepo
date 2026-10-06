package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.app.StaffState;
import com.shepherdjerred.thestorm.essentials.domain.place.DurationText;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;

/** Named jails with durable wall-clock sentences, return locations and escape guards. */
final class StaffJails implements Listener {
  private static final java.util.Set<String> ALLOWED =
      java.util.Set.of(
          "msg",
          "tell",
          "whisper",
          "w",
          "r",
          "mail",
          "help",
          "rules",
          "ticket",
          "tickets",
          "report",
          "msgtoggle",
          "rtoggle",
          "ignore");
  private final StaffCommands tools;

  StaffJails(StaffCommands tools) {
    this.tools = tools;
  }

  void register() {
    tools.add(
        "setjail <name>",
        request -> {
          var name = name(request.word(0));
          var location = Positions.current(request.self());
          if (!SafeLocations.isSafe(location))
            throw new IllegalArgumentException("Stand in a safe jail cell.");
          request.save(
              List.of(
                  tools.state.entry("jail-place", name, Positions.of(location)),
                  tools.state.entry("jail-deleted", name, false)),
              () -> request.say("Jail set."));
        });
    tools.add(
        "deljail <name>",
        request -> {
          var name = name(request.word(0));
          if (tools.state.keys("jail").stream()
              .map(UUID::fromString)
              .map(this::active)
              .flatMap(Optional::stream)
              .anyMatch(jail -> jail.name().equals(name)))
            throw new IllegalArgumentException("Release all prisoners before deleting this jail.");
          request.save(
              List.of(tools.state.entry("jail-deleted", name, true)),
              () -> request.say("Jail removed."));
        });
    tools.add(
        "jails",
        request ->
            request.say(
                "Jails: "
                    + String.join(
                        ", ",
                        tools.state.keys("jail-place").stream()
                            .filter(
                                name ->
                                    !tools
                                        .state
                                        .find("jail-deleted", name, Boolean.class)
                                        .orElse(false))
                            .toList())));
    tools.add(
        "jailedplayers",
        request ->
            request.say(
                "Prisoners: "
                    + String.join(
                        ", ",
                        tools.state.keys("jail").stream()
                            .filter(id -> active(UUID.fromString(id)).isPresent())
                            .toList())));
    tools.add("jail <player> <jail> [duration]", this::jail);
    tools.add("unjail <player>", this::release);
    tools.add(
        "togglejail <player> [jail] [duration]",
        request -> {
          var player = tools.player(request.actor(), request.word(0));
          request.others(player);
          if (active(player.getUniqueId()).isPresent()) release(request);
          else jail(request);
        });
  }

  private void jail(StaffCommands.Request request) {
    var player = tools.player(request.actor(), request.word(0));
    request.others(player);
    var name = name(request.word(1));
    if (tools.state.find("jail-deleted", name, Boolean.class).orElse(false))
      throw new IllegalArgumentException("Unknown jail.");
    var destination =
        tools
            .state
            .find("jail-place", name, Position.class)
            .orElseThrow(() -> new IllegalArgumentException("Unknown jail."));
    var returning =
        active(player.getUniqueId())
            .map(StaffState.Jail::returning)
            .orElseGet(() -> Positions.of(player));
    var expires =
        request.words().length > 2
            ? tools.context.time().instant().plus(duration(request.word(2)))
            : Instant.MAX;
    var sentence = new StaffState.Jail(name, destination, returning, expires, true);
    request.save(
        List.of(tools.state.entry("jail", player.getUniqueId().toString(), sentence)),
        () -> {
          enforce(player);
          request.say("Jailed " + player.getName() + ".");
        });
  }

  private void release(StaffCommands.Request request) {
    var player = tools.player(request.actor(), request.word(0));
    request.others(player);
    var jail =
        active(player.getUniqueId())
            .orElseThrow(() -> new IllegalArgumentException("Player is not jailed."));
    var released =
        new StaffState.Jail(
            jail.name(), jail.destination(), jail.returning(), jail.expires(), false);
    request.save(
        List.of(tools.state.entry("jail", player.getUniqueId().toString(), released)),
        () -> {
          returnTo(player, jail);
          request.say("Released " + player.getName() + ".");
        });
  }

  private Optional<StaffState.Jail> active(UUID player) {
    return recorded(player).filter(jail -> jail.activeAt(tools.context.time().instant()));
  }

  private Optional<StaffState.Jail> recorded(UUID player) {
    return tools.state.ready()
        ? tools.state.find("jail", player.toString(), StaffState.Jail.class)
        : Optional.empty();
  }

  private boolean jailed(Player player) {
    return active(player.getUniqueId()).isPresent();
  }

  private Location location(Position position) {
    return Positions.toLocation(tools.context.plugin().getServer(), position)
        .orElseThrow(() -> new IllegalArgumentException("Jail world is not loaded."));
  }

  private boolean inside(StaffState.Jail jail, Location destination) {
    var cell = location(jail.destination());
    return cell.getWorld().equals(destination.getWorld())
        && cell.distanceSquared(destination)
            <= (double) tools.settings.jailRadius() * tools.settings.jailRadius();
  }

  private void enforce(Player player) {
    active(player.getUniqueId())
        .ifPresent(
            jail -> {
              if (!inside(jail, Positions.current(player))) {
                var _ = player.teleportAsync(location(jail.destination()));
              }
            });
  }

  private void returnTo(Player player, StaffState.Jail jail) {
    var _ = player.teleportAsync(location(jail.returning()));
  }

  void sweep() {
    for (var player : tools.context.plugin().getServer().getOnlinePlayers())
      recorded(player.getUniqueId())
          .filter(StaffState.Jail::active)
          .ifPresent(
              jail -> {
                if (tools.context.time().instant().isBefore(jail.expires())) {
                  enforce(player);
                  return;
                }
                var released =
                    new StaffState.Jail(
                        jail.name(), jail.destination(), jail.returning(), jail.expires(), false);
                var audit =
                    new com.shepherdjerred.thestorm.essentials.app.StaffStore.Audit(
                        "system",
                        "jail.expire",
                        player.getUniqueId().toString(),
                        tools.context.time().instant());
                tools.complete(
                    player,
                    tools.state.commit(
                        List.of(
                            tools.state.entry("jail", player.getUniqueId().toString(), released)),
                        audit),
                    _ -> returnTo(player, jail));
              });
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void move(PlayerMoveEvent event) {
    active(event.getPlayer().getUniqueId())
        .ifPresent(
            jail -> {
              if (!inside(jail, java.util.Objects.requireNonNull(event.getTo())))
                event.setCancelled(true);
            });
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void teleport(PlayerTeleportEvent event) {
    move(event);
  }

  @EventHandler
  void join(PlayerJoinEvent event) {
    if (tools.state.ready()) enforce(event.getPlayer());
  }

  @EventHandler
  void respawn(PlayerRespawnEvent event) {
    active(event.getPlayer().getUniqueId())
        .ifPresent(jail -> event.setRespawnLocation(location(jail.destination())));
  }

  @EventHandler(ignoreCancelled = true)
  void command(PlayerCommandPreprocessEvent event) {
    if (jailed(event.getPlayer())
        && !ALLOWED.contains(
            event
                .getMessage()
                .substring(1)
                .split("\\s+", 2)[0]
                .toLowerCase(java.util.Locale.ROOT))) {
      event.setCancelled(true);
      event.getPlayer().sendMessage(Component.text("That command is unavailable while jailed."));
    }
  }

  @EventHandler(ignoreCancelled = true)
  void breaking(BlockBreakEvent event) {
    if (jailed(event.getPlayer())) event.setCancelled(true);
  }

  @EventHandler(ignoreCancelled = true)
  void placing(BlockPlaceEvent event) {
    if (jailed(event.getPlayer())) event.setCancelled(true);
  }

  @EventHandler(ignoreCancelled = true)
  void interact(PlayerInteractEvent event) {
    if (jailed(event.getPlayer())) event.setCancelled(true);
  }

  @EventHandler(ignoreCancelled = true)
  void entity(PlayerInteractEntityEvent event) {
    if (jailed(event.getPlayer())) event.setCancelled(true);
  }

  @EventHandler(ignoreCancelled = true)
  void damage(EntityDamageByEntityEvent event) {
    if (event.getDamager() instanceof Player player && jailed(player)) event.setCancelled(true);
  }

  @EventHandler(ignoreCancelled = true)
  void inventory(InventoryClickEvent event) {
    if (event.getWhoClicked() instanceof Player player && jailed(player)) event.setCancelled(true);
  }

  @EventHandler(ignoreCancelled = true)
  void drag(org.bukkit.event.inventory.InventoryDragEvent event) {
    if (event.getWhoClicked() instanceof Player player && jailed(player)) event.setCancelled(true);
  }

  @EventHandler(ignoreCancelled = true)
  void dropping(org.bukkit.event.player.PlayerDropItemEvent event) {
    if (jailed(event.getPlayer())) event.setCancelled(true);
  }

  @EventHandler(ignoreCancelled = true)
  void bucket(org.bukkit.event.player.PlayerBucketEmptyEvent event) {
    if (jailed(event.getPlayer())) event.setCancelled(true);
  }

  @EventHandler(ignoreCancelled = true)
  void collecting(org.bukkit.event.player.PlayerBucketFillEvent event) {
    if (jailed(event.getPlayer())) event.setCancelled(true);
  }

  private static String name(String input) {
    if (!input.matches("[a-zA-Z0-9_-]{1,32}"))
      throw new IllegalArgumentException(
          "Use a jail name of 1–32 letters, digits, underscores or hyphens.");
    return input.toLowerCase(java.util.Locale.ROOT);
  }

  private static Duration duration(String input) {
    return switch (DurationText.parse(input)) {
      case Result.Ok<Duration, String>(var duration) -> duration;
      case Result.Err<Duration, String>(var error) -> throw new IllegalArgumentException(error);
    };
  }
}
