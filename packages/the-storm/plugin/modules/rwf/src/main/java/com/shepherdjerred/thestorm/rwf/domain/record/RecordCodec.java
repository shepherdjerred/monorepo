package com.shepherdjerred.thestorm.rwf.domain.record;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.TreeMap;
import java.util.UUID;

/**
 * Writes and reads a {@link MatchRecord} as tab-separated lines, one row per record, so a recording
 * needs no library and can be appended to as the match runs: the row encoders ({@link #header},
 * {@link #event}, {@link #frame}, {@link #intent}, {@link #end}) write a match as it happens and
 * {@link #decode} reads the rows back in any order. Tabs, newlines and backslashes inside fields
 * are escaped with a backslash.
 */
public final class RecordCodec {

  private static final String NONE = "-";

  private RecordCodec() {}

  public static String encode(MatchRecord record) {
    var out = new StringBuilder();
    out.append(header(record.header()));
    for (var event : record.events()) {
      out.append(event(event));
    }
    for (var frame : record.frames()) {
      out.append(frame(frame));
    }
    for (var intent : record.intents()) {
      out.append(intent(intent));
    }
    out.append(end(record.end()));
    return out.toString();
  }

  /** The header row and one roster row per combatant, each newline-terminated. */
  public static String header(RecordHeader header) {
    var out = new StringBuilder();
    row(
        out,
        "H",
        String.valueOf(header.schemaVersion()),
        header.matchId().toString(),
        header.mapId(),
        header.mapBlocksSha256(),
        String.valueOf(header.seed()),
        header.combatRulesVersion());
    for (var entry : header.roster()) {
      row(
          out,
          "R",
          entry.pseudonym(),
          entry.team().name(),
          entry.kit(),
          String.valueOf(entry.bot()));
    }
    return out.toString();
  }

  /** One event row, newline-terminated. */
  public static String event(RecordEvent event) {
    var out = new StringBuilder();
    row(out, "E", String.valueOf(event.tick()), event.kind(), event.subject(), event.detail());
    return out.toString();
  }

  /** One frame row, newline-terminated. */
  public static String frame(Frame frame) {
    var out = new StringBuilder();
    row(
        out,
        "F",
        String.valueOf(frame.tick()),
        frame.pseudonym(),
        String.valueOf(frame.x()),
        String.valueOf(frame.y()),
        String.valueOf(frame.z()),
        String.valueOf(frame.yaw()),
        String.valueOf(frame.pitch()),
        String.valueOf(frame.health()),
        String.valueOf(frame.slot()),
        String.valueOf(frame.flags()));
    return out.toString();
  }

  /** One intent row, newline-terminated. */
  public static String intent(Intent intent) {
    var out = new StringBuilder();
    row(
        out,
        "I",
        String.valueOf(intent.tick()),
        intent.pseudonym(),
        intent.kind(),
        intent.target());
    return out.toString();
  }

  /** The end row and one payout row per paid pseudonym, each newline-terminated. */
  public static String end(RecordEnd end) {
    var out = new StringBuilder();
    row(
        out,
        "X",
        String.valueOf(end.tick()),
        end.winner().map(TeamColor::name).orElse(NONE),
        end.reason().name());
    for (var payout : end.payouts().entrySet()) {
      row(out, "P", payout.getKey(), String.valueOf(payout.getValue()));
    }
    return out.toString();
  }

  public static Result<MatchRecord, Problem> decode(String text) {
    var parser = new Parser();
    var lines = text.split("\n", -1);
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].isEmpty()) {
        continue;
      }
      try {
        parser.accept(lines[i]);
      } catch (IllegalArgumentException e) {
        return Result.err(new Problem(i + 1, message(e)));
      }
    }
    try {
      return Result.ok(parser.finish());
    } catch (IllegalArgumentException e) {
      return Result.err(new Problem(lines.length, message(e)));
    }
  }

  private static String message(IllegalArgumentException e) {
    return Objects.requireNonNullElse(e.getMessage(), e.getClass().getSimpleName());
  }

  private static void row(StringBuilder out, String tag, String... fields) {
    out.append(tag);
    for (var field : fields) {
      out.append('\t').append(escape(field));
    }
    out.append('\n');
  }

  static String escape(String field) {
    var out = new StringBuilder(field.length());
    for (var i = 0; i < field.length(); i++) {
      var c = field.charAt(i);
      switch (c) {
        case '\\' -> out.append("\\\\");
        case '\t' -> out.append("\\t");
        case '\n' -> out.append("\\n");
        default -> out.append(c);
      }
    }
    return out.toString();
  }

  static String unescape(String field) {
    var out = new StringBuilder(field.length());
    for (var i = 0; i < field.length(); i++) {
      var c = field.charAt(i);
      if (c != '\\') {
        out.append(c);
        continue;
      }
      if (i + 1 >= field.length()) {
        throw new IllegalArgumentException("dangling escape");
      }
      var next = field.charAt(++i);
      out.append(
          switch (next) {
            case '\\' -> '\\';
            case 't' -> '\t';
            case 'n' -> '\n';
            default -> throw new IllegalArgumentException("unknown escape \\" + next);
          });
    }
    return out.toString();
  }

  /**
   * Why a recording could not be read.
   *
   * @param line the 1-based line
   * @param message what was wrong
   */
  public record Problem(int line, String message) {}

  /** Accumulates rows into a record. */
  private static final class Parser {

    private Optional<RecordHeader> header = Optional.empty();
    private final List<RosterEntry> roster = new ArrayList<>();
    private final List<RecordEvent> events = new ArrayList<>();
    private final List<Frame> frames = new ArrayList<>();
    private final List<Intent> intents = new ArrayList<>();
    private Optional<RecordEnd> end = Optional.empty();
    private final Map<String, Long> payouts = new TreeMap<>();

    void accept(String line) {
      var raw = line.split("\t", -1);
      var fields = new String[raw.length];
      for (var i = 0; i < raw.length; i++) {
        fields[i] = unescape(raw[i]);
      }
      switch (fields[0]) {
        case "H" -> header(fields);
        case "R" ->
            roster.add(
                new RosterEntry(
                    at(fields, 1), team(at(fields, 2)), at(fields, 3), bool(at(fields, 4))));
        case "E" ->
            events.add(
                new RecordEvent(num(at(fields, 1)), at(fields, 2), at(fields, 3), at(fields, 4)));
        case "F" -> frames.add(frame(fields));
        case "I" ->
            intents.add(
                new Intent(num(at(fields, 1)), at(fields, 2), at(fields, 3), at(fields, 4)));
        case "X" -> end(fields);
        case "P" -> payouts.put(at(fields, 1), num(at(fields, 2)));
        default -> throw new IllegalArgumentException("unknown row tag " + fields[0]);
      }
    }

    private void header(String[] fields) {
      if (header.isPresent()) {
        throw new IllegalArgumentException("second header");
      }
      header =
          Optional.of(
              new RecordHeader(
                  (int) num(at(fields, 1)),
                  UUID.fromString(at(fields, 2)),
                  at(fields, 3),
                  at(fields, 4),
                  num(at(fields, 5)),
                  List.of(),
                  at(fields, 6)));
    }

    private static Frame frame(String[] f) {
      return new Frame(
          num(at(f, 1)),
          at(f, 2),
          (int) num(at(f, 3)),
          (int) num(at(f, 4)),
          (int) num(at(f, 5)),
          (int) num(at(f, 6)),
          (int) num(at(f, 7)),
          (int) num(at(f, 8)),
          (int) num(at(f, 9)),
          (int) num(at(f, 10)));
    }

    private void end(String[] fields) {
      if (end.isPresent()) {
        throw new IllegalArgumentException("second end");
      }
      var winner = at(fields, 2);
      end =
          Optional.of(
              new RecordEnd(
                  num(at(fields, 1)),
                  winner.equals(NONE) ? Optional.empty() : Optional.of(team(winner)),
                  RecordEnd.Reason.valueOf(at(fields, 3)),
                  Map.of()));
    }

    MatchRecord finish() {
      var head = header.orElseThrow(() -> new IllegalArgumentException("no header row"));
      var tail = end.orElseThrow(() -> new IllegalArgumentException("no end row"));
      return new MatchRecord(
          new RecordHeader(
              head.schemaVersion(),
              head.matchId(),
              head.mapId(),
              head.mapBlocksSha256(),
              head.seed(),
              roster,
              head.combatRulesVersion()),
          events,
          frames,
          intents,
          new RecordEnd(tail.tick(), tail.winner(), tail.reason(), payouts));
    }

    private static String at(String[] fields, int index) {
      if (index >= fields.length) {
        throw new IllegalArgumentException("row is missing field " + index);
      }
      return fields[index];
    }

    private static long num(String field) {
      try {
        return Long.parseLong(field);
      } catch (NumberFormatException e) {
        throw new IllegalArgumentException("not a number: " + field, e);
      }
    }

    private static boolean bool(String field) {
      return switch (field) {
        case "true" -> true;
        case "false" -> false;
        default -> throw new IllegalArgumentException("not a boolean: " + field);
      };
    }

    private static TeamColor team(String field) {
      return TeamColor.valueOf(field);
    }
  }
}
