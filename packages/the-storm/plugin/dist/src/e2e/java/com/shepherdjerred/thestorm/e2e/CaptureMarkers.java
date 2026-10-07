package com.shepherdjerred.thestorm.e2e;

import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.client.wire.DuelMarker;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.GameMode;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import tools.jackson.databind.json.JsonMapper;

/** Observer-only timing transport in the offline fixture jar; never admits a human to a duel. */
final class CaptureMarkers implements BasicCommand {
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private final JavaPlugin plugin;
  private Optional<UUID> observer = Optional.empty();
  private Optional<DuelMarker> last = Optional.empty();
  private long firstTick = -1;
  private String error = "";

  CaptureMarkers(JavaPlugin plugin) {
    this.plugin = plugin;
  }

  void register() {
    plugin.getServer().getMessenger().registerOutgoingPluginChannel(plugin, DuelMarker.CHANNEL);
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> event.registrar().register("rwfcapture", this));
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (!(source.getSender() instanceof ConsoleCommandSender
        || source.getSender() instanceof RemoteConsoleCommandSender)) {
      source
          .getSender()
          .sendMessage(Component.text("rwfcapture requires the disposable server console"));
      return;
    }
    try {
      if (args.length == 2 && args[0].equals("observe")) {
        if (active()) throw new IllegalStateException("Cannot replace an active duel observer");
        var player = plugin.getServer().getPlayer(UUID.fromString(args[1]));
        if (player == null) throw new IllegalArgumentException("Observer is not connected");
        requireSpectator(player);
        if (!player.getListeningPluginChannels().contains(DuelMarker.CHANNEL))
          throw new IllegalArgumentException("Observer lacks the native duel clock channel");
        observer = Optional.of(player.getUniqueId());
        last = Optional.empty();
        error = "";
      } else if (args.length == 1 && args[0].equals("clear")) {
        if (active()) throw new IllegalStateException("Cannot remove an active duel observer");
        observer = Optional.empty();
        last = Optional.empty();
        error = "";
      } else if (!(args.length == 1 && args[0].equals("state"))) {
        throw new IllegalArgumentException("observe <uuid>, state, clear");
      }
      reply(
          source,
          Map.of(
              "observer",
              observer.map(UUID::toString).orElse(""),
              "active",
              active(),
              "match",
              last.map(marker -> marker.match().toString()).orElse(""),
              "error",
              error));
    } catch (IllegalArgumentException | IllegalStateException failure) {
      reply(source, Map.of("error", failure.getMessage()));
    }
  }

  private static void reply(CommandSourceStack source, Object reply) {
    source.getSender().sendMessage(Component.text(JSON.writeValueAsString(reply)));
  }

  void begin(UUID match, long seed, String side, String mode, String opponent) {
    if (observer.isEmpty()) return;
    if (active()) throw new IllegalStateException("Previous observer duel is still active");
    firstTick = -1;
    var player = player();
    emit(
        player,
        new DuelMarker(
            match,
            seed,
            side,
            mode,
            opponent,
            0,
            "begin",
            -1,
            player.getWorld().getGameTime(),
            -1,
            "waiting"));
  }

  void requireReady(long seed) {
    if (observer.isEmpty()) return;
    player();
    if (!error.isEmpty())
      throw new IllegalStateException("Previous observer transport failed: " + error);
    if (seed < -DuelMarker.MAXIMUM_SAFE_INTEGER || seed > DuelMarker.MAXIMUM_SAFE_INTEGER)
      throw new IllegalArgumentException("Capture seed is not a safe integer");
  }

  void tick(long tick) {
    if (observer.isEmpty()) return;
    var previous = last.orElseThrow(() -> new IllegalStateException("Duel capture was not begun"));
    if (!active()) throw new IllegalStateException("Duel capture tick followed a terminal marker");
    if (firstTick == -1) firstTick = tick;
    var elapsed = Math.toIntExact(tick - firstTick);
    var connected = connectedObserver();
    if (connected.isEmpty()) return;
    var player = connected.orElseThrow();
    var current = current();
    if (!current.matchId().equals(previous.match())
        || current.phase() != MatchState.Phase.LIVE
        || current.combatants().size() != 2
        || current.combatants().stream().anyMatch(fighter -> !fighter.bot()))
      throw new IllegalStateException("Observer duel roster or phase changed");
    emit(
        player,
        new DuelMarker(
            previous.match(),
            previous.seed(),
            previous.side(),
            previous.mode(),
            previous.opponent(),
            previous.sequence() + 1,
            "tick",
            tick,
            player.getWorld().getGameTime(),
            elapsed,
            "live"));
  }

  void terminal(String result) {
    if (!active()) return;
    var previous = last.orElseThrow();
    var connected = connectedObserver();
    if (connected.isEmpty()) {
      last = Optional.empty();
      return;
    }
    var player = connected.orElseThrow();
    emit(
        player,
        new DuelMarker(
            previous.match(),
            previous.seed(),
            previous.side(),
            previous.mode(),
            previous.opponent(),
            previous.sequence() + 1,
            "terminal",
            previous.tick(),
            player.getWorld().getGameTime(),
            previous.elapsed(),
            result));
  }

  private boolean active() {
    return last.filter(marker -> !marker.marker().equals("terminal")).isPresent();
  }

  private Player player() {
    var player = plugin.getServer().getPlayer(observer.orElseThrow());
    if (player == null) throw new IllegalStateException("Duel observer disconnected");
    requireSpectator(player);
    return player;
  }

  private Optional<Player> connectedObserver() {
    if (!error.isEmpty()) return Optional.empty();
    try {
      return Optional.of(player());
    } catch (IllegalStateException failure) {
      // A lost external observer invalidates its evidence; it must not stop native combat.
      error = failure.toString();
      return Optional.empty();
    }
  }

  private MatchState current() {
    var found = plugin.getServer().getPluginManager().getPlugin("TheStorm");
    if (!(found instanceof TheStormPlugin storm))
      throw new IllegalStateException("TheStorm missing");
    return storm.service(MatchView.class).current().map(MatchState::of).orElseThrow();
  }

  private void requireSpectator(Player player) {
    var current = current();
    if (player.getGameMode() != GameMode.SPECTATOR
        || current.combatant(player.getUniqueId()).isPresent()
        || !current.mapId().orElseThrow().equals("training-yard")
        || !player.getWorld().getName().equals("rwf"))
      throw new IllegalStateException(
          "Observer must be an unrostered spectator in the fixture training-yard world");
  }

  private void emit(Player player, DuelMarker marker) {
    player.sendPluginMessage(plugin, DuelMarker.CHANNEL, marker.encode());
    last = Optional.of(marker);
  }
}
