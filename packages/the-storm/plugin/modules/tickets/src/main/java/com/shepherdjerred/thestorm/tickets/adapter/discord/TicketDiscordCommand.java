package com.shepherdjerred.thestorm.tickets.adapter.discord;

import com.shepherdjerred.thestorm.discord.app.DiscordCommand;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.tickets.app.TicketService;
import com.shepherdjerred.thestorm.tickets.domain.Ticket;
import com.shepherdjerred.thestorm.tickets.domain.TicketCategory;
import com.shepherdjerred.thestorm.tickets.domain.TicketDraft;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;

/**
 * {@code /ticket <category> <summary>} from Discord: files a ticket for the sender's linked player,
 * without a location. It is triaged and posted like any other ticket.
 */
public final class TicketDiscordCommand {

  /** How long one Discord user waits between tickets. */
  static final Duration COOLDOWN = Duration.ofMinutes(2);

  private final TicketService tickets;
  private final ComponentLogger logger;

  public TicketDiscordCommand(TicketService tickets, ComponentLogger logger) {
    this.tickets = tickets;
    this.logger = logger;
  }

  public DiscordCommand command() {
    return new DiscordCommand(
        "ticket",
        "Report a problem to staff from your linked player",
        List.of(
            new DiscordCommand.Option("category", "One of: " + categories(), true),
            new DiscordCommand.Option("summary", "What happened", true)),
        COOLDOWN,
        this::answer);
  }

  private void answer(DiscordCommand.Request request, Consumer<String> reply) {
    var reporter = request.player();
    if (reporter.isEmpty()) {
      reply.accept("Link your account first: use /link here.");
      return;
    }
    var category = category(request.options().getOrDefault("category", ""));
    if (category.isEmpty()) {
      reply.accept("Pick a category: " + categories() + ".");
      return;
    }
    var summary = request.options().getOrDefault("summary", "").strip();
    if (summary.isEmpty() || summary.length() > Ticket.MAX_SUMMARY_LENGTH) {
      reply.accept("Write a summary of 1 to " + Ticket.MAX_SUMMARY_LENGTH + " characters.");
      return;
    }
    var _ =
        tickets
            .open(
                new TicketDraft(
                    reporter.orElseThrow(), category.orElseThrow(), summary, Optional.empty()))
            .whenComplete(
                (ticket, failure) -> {
                  if (failure != null) {
                    logger.error(Component.text("tickets: filing from Discord failed"), failure);
                    reply.accept("Filing failed; staff have been told.");
                  } else {
                    reply.accept(
                        "Ticket #"
                            + ticket.id()
                            + " opened: "
                            + DiscordRelay.escape(summary)
                            + ". Staff will review it.");
                  }
                });
  }

  static Optional<TicketCategory> category(String id) {
    var wanted = id.strip().toLowerCase(Locale.ROOT);
    return Arrays.stream(TicketCategory.values())
        .filter(category -> category.id().equals(wanted))
        .findFirst();
  }

  private static String categories() {
    return Arrays.stream(TicketCategory.values())
        .map(TicketCategory::id)
        .collect(Collectors.joining(", "));
  }
}
