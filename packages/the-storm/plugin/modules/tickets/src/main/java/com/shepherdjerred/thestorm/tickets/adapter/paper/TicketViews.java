package com.shepherdjerred.thestorm.tickets.adapter.paper;

import static java.time.format.DateTimeFormatter.ofPattern;

import com.shepherdjerred.thestorm.tickets.domain.Ticket;
import com.shepherdjerred.thestorm.tickets.domain.TicketComment;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.JoinConfiguration;

/**
 * Ticket text for commands. Pure rendering over caller-resolved names, so it tests without a
 * server.
 */
final class TicketViews {

  private static final DateTimeFormatter WHEN =
      ofPattern("yyyy-MM-dd HH:mm 'UTC'").withZone(ZoneOffset.UTC);
  private static final int SUMMARY_PREVIEW = 60;

  private TicketViews() {}

  /** One queue line: id, status, priority, category, reporter, and a summary preview. */
  static Component queueLine(Ticket ticket, Function<UUID, String> names) {
    return Component.text(
        "#"
            + ticket.id()
            + " ["
            + ticket.status().id()
            + "] ["
            + ticket.priority().id()
            + "] "
            + ticket.category().id()
            + " — "
            + preview(ticket.summary())
            + " ("
            + names.apply(ticket.reporter())
            + ")");
  }

  /**
   * The full ticket: header, summary, location, claimer, triage, and comments. Reporters see their
   * ticket without the triage and staff notes; staff see everything.
   */
  static Component detail(
      Ticket ticket, List<TicketComment> comments, Function<UUID, String> names, boolean staff) {
    var lines = new ArrayList<Component>();
    lines.add(
        Component.text(
            "Ticket #"
                + ticket.id()
                + " ["
                + ticket.status().id()
                + "] ["
                + ticket.priority().id()
                + "] "
                + ticket.category().id()));
    lines.add(
        Component.text(
            "From " + names.apply(ticket.reporter()) + " at " + WHEN.format(ticket.createdAt())));
    lines.add(Component.text(ticket.summary()));
    ticket
        .location()
        .ifPresent(
            place ->
                lines.add(
                    Component.text(
                        "At "
                            + place.world()
                            + " "
                            + place.x()
                            + " "
                            + place.y()
                            + " "
                            + place.z())));
    ticket
        .claimer()
        .ifPresent(owner -> lines.add(Component.text("Claimed by " + names.apply(owner))));
    if (staff) {
      ticket
          .triage()
          .ifPresent(
              triage ->
                  lines.add(
                      Component.text(
                          "Triage [" + triage.priority().id() + "]: " + triage.evidence())));
    }
    for (var comment : comments) {
      if (comment.staffOnly() && !staff) {
        continue;
      }
      lines.add(
          Component.text(
              names.apply(comment.author())
                  + (comment.staffOnly() ? " (staff)" : "")
                  + ": "
                  + comment.body()));
    }
    return Component.join(JoinConfiguration.newlines(), lines);
  }

  private static String preview(String summary) {
    if (summary.length() <= SUMMARY_PREVIEW) {
      return summary;
    }
    return summary.substring(0, SUMMARY_PREVIEW - 1) + "…";
  }
}
