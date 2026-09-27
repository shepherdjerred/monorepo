package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.players.KnownPlayer;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.towns.domain.town.PlayerRef;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.bukkit.Server;
import org.bukkit.command.CommandSender;

/**
 * Players by name and names by player, for commands that name someone who may be offline. Online
 * players answer at once; everyone else comes from core's {@link PlayerDirectory}, off the main
 * thread, and the answer is handed back on it.
 */
final class Names {

  private final Server server;
  private final PlayerDirectory directory;
  private final Scheduler scheduler;

  Names(Server server, PlayerDirectory directory, Scheduler scheduler) {
    this.server = server;
    this.directory = directory;
    this.scheduler = scheduler;
  }

  Server server() {
    return server;
  }

  /**
   * Finds the player called {@code name} and runs {@code then} with them on the main thread; tells
   * {@code sender} when nobody by that name has ever joined.
   */
  void resolve(CommandSender sender, String name, Consumer<PlayerRef> then) {
    var online = server.getPlayerExact(name);
    if (online != null) {
      then.accept(new PlayerRef(online.getUniqueId(), online.getName()));
      return;
    }
    var _ =
        directory
            .byName(name)
            .whenCompleteAsync(
                (found, failure) -> {
                  if (failure != null || found == null) {
                    sender.sendMessage(Notices.error("Could not look up " + name + "; try again."));
                    return;
                  }
                  found.ifPresentOrElse(
                      player -> then.accept(new PlayerRef(player.uuid(), player.lastName())),
                      () ->
                          sender.sendMessage(
                              Notices.error("Nobody called " + name + " has played here.")));
                },
                scheduler.mainThread());
  }

  /**
   * The names of {@code players}, on the main thread. Everyone in a town has joined, so every id is
   * in the directory; one that is not (a hand-edited database) shows as the start of its id.
   */
  CompletableFuture<Map<UUID, String>> namesOf(Collection<UUID> players) {
    var names = new HashMap<UUID, String>();
    var lookups = new ArrayList<CompletableFuture<Optional<KnownPlayer>>>();
    for (var player : players) {
      var online = server.getPlayer(player);
      if (online != null) {
        names.put(player, online.getName());
      } else {
        lookups.add(directory.byId(player));
      }
    }
    return CompletableFuture.allOf(lookups.toArray(CompletableFuture[]::new))
        .thenApplyAsync(
            done -> {
              for (var lookup : lookups) {
                lookup.resultNow().ifPresent(known -> names.put(known.uuid(), known.lastName()));
              }
              for (var player : players) {
                names.computeIfAbsent(player, Names::shortId);
              }
              return Map.copyOf(names);
            },
            scheduler.mainThread());
  }

  private static String shortId(UUID player) {
    return player.toString().substring(0, 8);
  }
}
