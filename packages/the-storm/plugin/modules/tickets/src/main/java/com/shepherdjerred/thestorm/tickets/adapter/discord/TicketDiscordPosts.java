package com.shepherdjerred.thestorm.tickets.adapter.discord;

import com.shepherdjerred.thestorm.core.players.KnownPlayer;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.discord.app.TicketDetails;
import com.shepherdjerred.thestorm.tickets.app.TicketEvent;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshot;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;

/** Posts ticket changes to Discord. Best effort: failures are logged, never thrown. */
public final class TicketDiscordPosts {

  private final DiscordRelay relay;
  private final PlayerDirectory players;
  private final ComponentLogger logger;

  public TicketDiscordPosts(DiscordRelay relay, PlayerDirectory players, ComponentLogger logger) {
    this.relay = relay;
    this.players = players;
    this.logger = logger;
  }

  /** Posts {@code event} once its names resolve. */
  public void post(TicketEvent event) {
    var ticket = event.ticket();
    var ids = new HashSet<UUID>();
    ids.add(ticket.reporter());
    ticket.claimer().ifPresent(ids::add);
    var lookups = lookups(ids);
    var _ =
        CompletableFuture.allOf(lookups.values().toArray(CompletableFuture[]::new))
            .whenComplete((done, failure) -> postResolved(event, ticket, lookups, failure));
  }

  private Map<UUID, CompletableFuture<String>> lookups(Set<UUID> ids) {
    Map<UUID, CompletableFuture<String>> lookups = new HashMap<>();
    for (var id : ids) {
      lookups.put(
          id,
          players
              .byId(id)
              .thenApply(found -> found.map(KnownPlayer::lastName).orElseGet(() -> shortId(id))));
    }
    return lookups;
  }

  private void postResolved(
      TicketEvent event,
      TicketSnapshot ticket,
      Map<UUID, CompletableFuture<String>> lookups,
      Throwable failure) {
    if (failure != null) {
      logger.error(Component.text("tickets: naming a ticket post failed"), failure);
      return;
    }
    try {
      Map<UUID, String> resolved = new HashMap<>();
      lookups.forEach((id, lookup) -> resolved.put(id, lookup.join()));
      Function<UUID, String> names = id -> resolved.getOrDefault(id, shortId(id));
      switch (event) {
        case TicketEvent.Opened _ -> relay.onTicketOpened(details(ticket, names, ""));
        case TicketEvent.Claimed _ -> relay.onTicketClaimed(details(ticket, names, ""));
        case TicketEvent.Resolved _ -> relay.onTicketResolved(details(ticket, names, ""));
        case TicketEvent.Escalated _ -> relay.onTicketEscalated(details(ticket, names, ""));
        case TicketEvent.Reopened _ -> relay.onTicketReopened(details(ticket, names, ""));
        case TicketEvent.Triaged _ ->
            relay.onTicketTriaged(details(ticket, names, ticket.triage().orElseThrow().evidence()));
      }
    } catch (RuntimeException e) {
      logger.error(Component.text("tickets: posting a ticket to Discord failed"), e);
    }
  }

  private static TicketDetails details(
      TicketSnapshot ticket, Function<UUID, String> names, String evidence) {
    return new TicketDetails(
        ticket.id(),
        ticket.categoryId(),
        ticket.priorityId(),
        names.apply(ticket.reporter()),
        ticket.summary(),
        ticket.claimer().map(names).orElse("staff"),
        evidence,
        ticket.server());
  }

  private static String shortId(UUID id) {
    return id.toString().substring(0, 8);
  }
}
