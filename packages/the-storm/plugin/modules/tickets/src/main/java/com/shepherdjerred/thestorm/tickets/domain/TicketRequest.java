package com.shepherdjerred.thestorm.tickets.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.Locale;
import java.util.function.BiFunction;
import java.util.function.LongFunction;

/**
 * One {@code /ticket} line, parsed. A leading action word routes to staff handling; anything else
 * files a report, with a leading category word naming its category.
 */
public sealed interface TicketRequest {

  /** File a report: {@code /ticket [grief|theft|cheat|chat|appeal|other] <what happened>}. */
  record File(TicketCategory category, String summary) implements TicketRequest {}

  /** Show a ticket: {@code /ticket view <id>}. */
  record View(long id) implements TicketRequest {}

  /** Claim a ticket: {@code /ticket claim <id>}. */
  record Claim(long id) implements TicketRequest {}

  /** Comment publicly: {@code /ticket comment <id> <text>}. */
  record Comment(long id, String text) implements TicketRequest {}

  /** Leave a staff-only note: {@code /ticket note <id> <text>}. */
  record Note(long id, String text) implements TicketRequest {}

  /** Resolve a ticket: {@code /ticket resolve <id> [note]}. */
  record Resolve(long id, String note) implements TicketRequest {}

  /** Escalate a ticket to a human reviewer: {@code /ticket escalate <id>}. */
  record Escalate(long id) implements TicketRequest {}

  /** Reopen a resolved ticket: {@code /ticket reopen <id>}. */
  record Reopen(long id) implements TicketRequest {}

  /**
   * Parses {@code input}. Failures carry the message to show the sender.
   *
   * @param input the command line after {@code /ticket}
   */
  static Result<TicketRequest, String> parse(String input) {
    var line = input.strip();
    if (line.isEmpty()) {
      return Result.err("Say what happened, or name a ticket action.");
    }
    var head = firstWord(line);
    var tail = line.substring(head.length()).strip();
    return switch (head.toLowerCase(Locale.ROOT)) {
      case "view" -> idOnly(tail, View::new);
      case "claim" -> idOnly(tail, Claim::new);
      case "escalate" -> idOnly(tail, Escalate::new);
      case "reopen" -> idOnly(tail, Reopen::new);
      case "comment" -> idAndText(tail, Comment::new);
      case "note" -> idAndText(tail, Note::new);
      case "resolve" -> idAndOptionalText(tail);
      default -> Result.ok(file(line));
    };
  }

  private static TicketRequest file(String line) {
    for (var category : TicketCategory.values()) {
      if (category == TicketCategory.OTHER) {
        continue;
      }
      var prefix = category.id() + " ";
      if (line.regionMatches(true, 0, prefix, 0, prefix.length())) {
        return new File(category, line.substring(prefix.length()).strip());
      }
    }
    return new TicketRequest.File(TicketCategory.OTHER, line);
  }

  private static Result<TicketRequest, String> idOnly(
      String tail, LongFunction<TicketRequest> make) {
    if (tail.isEmpty()) {
      return Result.err("Name a ticket id.");
    }
    try {
      return Result.ok(make.apply(Long.parseLong(firstWord(tail))));
    } catch (NumberFormatException e) {
      return Result.err("Ticket id must be a number.");
    }
  }

  private static Result<TicketRequest, String> idAndText(
      String tail, BiFunction<Long, String, TicketRequest> make) {
    if (tail.isEmpty()) {
      return Result.err("Name a ticket id.");
    }
    var idWord = firstWord(tail);
    var text = tail.substring(idWord.length()).strip();
    if (text.isEmpty()) {
      return Result.err("Say something first.");
    }
    try {
      return Result.ok(make.apply(Long.parseLong(idWord), text));
    } catch (NumberFormatException e) {
      return Result.err("Ticket id must be a number.");
    }
  }

  private static Result<TicketRequest, String> idAndOptionalText(String tail) {
    if (tail.isEmpty()) {
      return Result.err("Name a ticket id.");
    }
    var idWord = firstWord(tail);
    var note = tail.substring(idWord.length()).strip();
    try {
      return Result.ok(new Resolve(Long.parseLong(idWord), note));
    } catch (NumberFormatException e) {
      return Result.err("Ticket id must be a number.");
    }
  }

  /** The text up to the first whitespace, or the whole line. */
  private static String firstWord(String line) {
    for (var i = 0; i < line.length(); i++) {
      if (Character.isWhitespace(line.charAt(i))) {
        return line.substring(0, i);
      }
    }
    return line;
  }
}
