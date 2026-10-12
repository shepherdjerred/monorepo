package com.shepherdjerred.thestorm.rwf.domain.record;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonClock;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;

/**
 * Writes and reads a {@link MatchRecord} as tab-separated lines, one row per record, so a recording
 * needs no library and can be appended to as the match runs: the row encoders ({@link #header},
 * {@link #event}, {@link #frame}, {@link #intent}, {@link #occurrence}, {@link #end}) write a match
 * as it happens and {@link #decode} or {@link #read} read the rows back in any order, which is
 * where a replay starts. Tabs, newlines and backslashes inside fields are escaped with a backslash.
 */
public final class RecordCodec {

  private static final String NONE = "-";

  /** The schema 4 occurrence row tags. */
  private static final Set<String> OCCURRENCE_TAGS =
      Set.of("B", "J", "A", "U", "K", "C", "V", "D", "S");

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
    for (var input : record.inputs()) {
      out.append(record.header().schemaVersion() == 2 ? legacyInput(input) : input(input));
    }
    for (var intent : record.intents()) {
      out.append(intent(intent));
    }
    for (var observation : record.observations()) {
      out.append(observation(observation));
    }
    for (var occurrence : record.occurrences()) {
      out.append(occurrence(occurrence));
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

  /** One human input row, newline-terminated. */
  public static String input(InputFrame input) {
    var out = new StringBuilder();
    row(
        out,
        "N",
        String.valueOf(input.tick()),
        input.pseudonym(),
        String.valueOf(input.keys()),
        String.valueOf(input.yaw()),
        String.valueOf(input.pitch()),
        String.valueOf(input.attack()),
        String.valueOf(input.use()),
        String.valueOf(input.slot()),
        String.valueOf(input.sequence()),
        String.valueOf(input.observationTick()),
        input.source().name());
    return out.toString();
  }

  private static String legacyInput(InputFrame input) {
    var out = new StringBuilder();
    row(
        out,
        "N",
        String.valueOf(input.tick()),
        input.pseudonym(),
        String.valueOf(input.keys()),
        String.valueOf(input.yaw()),
        String.valueOf(input.pitch()));
    return out.toString();
  }

  public static String observation(ObservationFrame observation) {
    var fields = new ArrayList<String>();
    fields.add(String.valueOf(observation.tick()));
    fields.add(observation.pseudonym());
    fields.add(observation.contract());
    observation.values().forEach(value -> fields.add(String.valueOf(value)));
    var out = new StringBuilder();
    row(out, "O", fields.toArray(String[]::new));
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

  /** One schema 4 occurrence row, newline-terminated. */
  public static String occurrence(Occurrence occurrence) {
    var out = new StringBuilder();
    switch (occurrence) {
      case Occurrence.BlockChange block ->
          row(
              out,
              "B",
              String.valueOf(block.tick()),
              String.valueOf(block.x()),
              String.valueOf(block.y()),
              String.valueOf(block.z()),
              block.state(),
              block.reason().name());
      case Occurrence.Projectile shot ->
          row(
              out,
              "J",
              String.valueOf(shot.tick()),
              shot.shooter(),
              shot.kind(),
              String.valueOf(shot.x()),
              String.valueOf(shot.y()),
              String.valueOf(shot.z()),
              String.valueOf(shot.vx()),
              String.valueOf(shot.vy()),
              String.valueOf(shot.vz()));
      case Occurrence.AbilityUse use ->
          row(
              out,
              "A",
              String.valueOf(use.tick()),
              use.user(),
              use.ability(),
              use.target().orElse(""));
      case Occurrence.EffectApplied effect ->
          row(
              out,
              "U",
              String.valueOf(effect.tick()),
              effect.subject(),
              effect.effect(),
              String.valueOf(effect.amplifier()),
              String.valueOf(effect.durationTicks()));
      case Occurrence.Killstreak streak ->
          row(
              out,
              "K",
              String.valueOf(streak.tick()),
              streak.earner(),
              streak.streak(),
              String.valueOf(streak.kills()));
      case Occurrence.Chat chat ->
          row(
              out,
              "C",
              String.valueOf(chat.tick()),
              chat.speaker(),
              chat.channel(),
              String.valueOf(chat.length()),
              chat.text().orElse(""));
      case Occurrence.Ballot ballot -> {
        var fields = new ArrayList<String>();
        fields.add(String.valueOf(ballot.tick()));
        fields.add(ballot.chosen());
        for (var candidate : ballot.votes()) {
          fields.add(candidate.mapId());
          fields.add(String.valueOf(candidate.votes()));
        }
        row(out, "V", fields.toArray(String[]::new));
      }
      case Occurrence.Kill kill -> {
        var fields = new ArrayList<String>();
        fields.add(String.valueOf(kill.tick()));
        fields.add(kill.victim());
        fields.add(kill.killer().orElse(NONE));
        fields.add(kill.cause());
        fields.add(kill.weapon().orElse(NONE));
        fields.add(
            kill.distance().isPresent() ? String.valueOf(kill.distance().getAsDouble()) : NONE);
        new TreeMap<>(kill.assists())
            .forEach((pseudonym, share) -> fields.add(pseudonym + "=" + share));
        row(out, "D", fields.toArray(String[]::new));
      }
      case Occurrence.Pulse pulse -> {
        var teams = new ArrayList<String>();
        for (var team : TeamColor.values()) {
          var alive = pulse.alive().get(team);
          if (alive != null) {
            teams.add(team.name() + "=" + alive);
          }
        }
        var bombs = new ArrayList<String>();
        new TreeMap<>(pulse.bombs()).forEach((id, status) -> bombs.add(id + "=" + status.name()));
        row(
            out,
            "S",
            String.valueOf(pulse.tick()),
            pulse.poison().name(),
            String.join(",", teams),
            String.join(",", bombs));
      }
    }
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
      var refused = parser.line(i + 1, lines[i]);
      if (refused.isPresent()) {
        return Result.err(refused.orElseThrow());
      }
    }
    return parser.result(lines.length);
  }

  /**
   * Reads a whole recording row by row, as a replay does, without first holding its text: the
   * decoded rows of a long match take far less memory than the text. The caller owns {@code reader}
   * (typically over a {@code GZIPInputStream} of a {@code .rwfrec.gz} file) and closes it.
   *
   * @throws UncheckedIOException when the reader fails
   */
  public static Result<MatchRecord, Problem> read(BufferedReader reader) {
    var parser = new Parser();
    var number = 0;
    try {
      for (var line = reader.readLine(); line != null; line = reader.readLine()) {
        number++;
        var refused = parser.line(number, line);
        if (refused.isPresent()) {
          return Result.err(refused.orElseThrow());
        }
      }
    } catch (IOException e) {
      throw new UncheckedIOException("could not read the recording", e);
    }
    return parser.result(number);
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
    private final List<InputFrame> inputs = new ArrayList<>();
    private final List<ObservationFrame> observations = new ArrayList<>();
    private final List<Intent> intents = new ArrayList<>();
    private final List<Occurrence> occurrences = new ArrayList<>();
    private Optional<RecordEnd> end = Optional.empty();
    private final Map<String, Long> payouts = new TreeMap<>();

    /** Takes one line; empty lines are skipped. Returns why the line was refused, if it was. */
    Optional<Problem> line(int number, String line) {
      if (line.isEmpty()) {
        return Optional.empty();
      }
      try {
        accept(line);
        return Optional.empty();
      } catch (IllegalArgumentException e) {
        return Optional.of(new Problem(number, message(e)));
      }
    }

    Result<MatchRecord, Problem> result(int lastLine) {
      try {
        return Result.ok(finish());
      } catch (IllegalArgumentException e) {
        return Result.err(new Problem(lastLine, message(e)));
      }
    }

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
        case "N" -> inputs.add(input(fields));
        case "O" -> observations.add(observation(fields));
        case "I" ->
            intents.add(
                new Intent(num(at(fields, 1)), at(fields, 2), at(fields, 3), at(fields, 4)));
        case "X" -> end(fields);
        case "P" -> payouts.put(at(fields, 1), num(at(fields, 2)));
        default -> occurrences.add(occurrenceRow(fields));
      }
    }

    private ObservationFrame observation(String[] fields) {
      if (version("observation") < 3) {
        throw new IllegalArgumentException("observations require schema 3");
      }
      var values = new ArrayList<Double>();
      for (var i = 4; i < fields.length; i++) {
        values.add(Double.parseDouble(fields[i]));
      }
      return new ObservationFrame(num(at(fields, 1)), at(fields, 2), at(fields, 3), values);
    }

    private Occurrence occurrenceRow(String[] fields) {
      if (!OCCURRENCE_TAGS.contains(fields[0])) {
        throw new IllegalArgumentException("unknown row tag " + fields[0]);
      }
      if (version("occurrence") < 4) {
        throw new IllegalArgumentException("occurrence rows require schema 4");
      }
      return occurrence(fields);
    }

    private void header(String[] fields) {
      if (header.isPresent()) {
        throw new IllegalArgumentException("second header");
      }
      var version = num(at(fields, 1));
      if (!MatchRecord.readable(version)) {
        throw new IllegalArgumentException("unsupported record schema " + version);
      }
      header =
          Optional.of(
              new RecordHeader(
                  integer(at(fields, 1)),
                  UUID.fromString(at(fields, 2)),
                  at(fields, 3),
                  at(fields, 4),
                  num(at(fields, 5)),
                  List.of(),
                  at(fields, 6)));
    }

    private int version(String what) {
      return header
          .orElseThrow(() -> new IllegalArgumentException(what + " before header"))
          .schemaVersion();
    }

    private static Occurrence occurrence(String[] f) {
      var tick = num(at(f, 1));
      return switch (f[0]) {
        case "B" -> {
          exactly(f, 7);
          yield new Occurrence.BlockChange(
              tick,
              integer(at(f, 2)),
              integer(at(f, 3)),
              integer(at(f, 4)),
              at(f, 5),
              Occurrence.BlockChange.Reason.valueOf(at(f, 6)));
        }
        case "J" -> {
          exactly(f, 10);
          yield new Occurrence.Projectile(
              tick,
              at(f, 2),
              at(f, 3),
              decimal(at(f, 4)),
              decimal(at(f, 5)),
              decimal(at(f, 6)),
              decimal(at(f, 7)),
              decimal(at(f, 8)),
              decimal(at(f, 9)));
        }
        case "A" -> {
          exactly(f, 5);
          yield new Occurrence.AbilityUse(tick, at(f, 2), at(f, 3), optional(at(f, 4)));
        }
        case "U" -> {
          exactly(f, 6);
          yield new Occurrence.EffectApplied(
              tick, at(f, 2), at(f, 3), integer(at(f, 4)), integer(at(f, 5)));
        }
        case "K" -> {
          exactly(f, 5);
          yield new Occurrence.Killstreak(tick, at(f, 2), at(f, 3), integer(at(f, 4)));
        }
        case "C" -> {
          exactly(f, 6);
          yield new Occurrence.Chat(
              tick, at(f, 2), at(f, 3), integer(at(f, 4)), optional(at(f, 5)));
        }
        case "V" -> ballot(tick, f);
        case "D" -> kill(tick, f);
        case "S" -> pulse(tick, f);
        default -> throw new IllegalArgumentException("unknown occurrence " + f[0]);
      };
    }

    private static Occurrence.Ballot ballot(long tick, String[] f) {
      if (f.length < 5 || f.length % 2 == 0) {
        throw new IllegalArgumentException("a ballot row pairs each map with its votes");
      }
      var votes = new ArrayList<Occurrence.Ballot.Candidate>();
      for (var i = 3; i < f.length; i += 2) {
        votes.add(new Occurrence.Ballot.Candidate(f[i], integer(f[i + 1])));
      }
      return new Occurrence.Ballot(tick, votes, at(f, 2));
    }

    private static Occurrence.Kill kill(long tick, String[] f) {
      if (f.length < 7) {
        throw new IllegalArgumentException("a kill row has at least 7 fields");
      }
      var assists = new TreeMap<String, Double>();
      for (var i = 7; i < f.length; i++) {
        var pair = f[i].split("=", -1);
        if (pair.length != 2 || assists.put(pair[0], decimal(pair[1])) != null) {
          throw new IllegalArgumentException("invalid or repeated assist: " + f[i]);
        }
      }
      var distance = at(f, 6);
      return new Occurrence.Kill(
          tick,
          at(f, 2),
          noneable(at(f, 3)),
          at(f, 4),
          noneable(at(f, 5)),
          distance.equals(NONE) ? OptionalDouble.empty() : OptionalDouble.of(decimal(distance)),
          assists);
    }

    private static Occurrence.Pulse pulse(long tick, String[] f) {
      exactly(f, 5);
      var alive = new EnumMap<TeamColor, Integer>(TeamColor.class);
      for (var pair : pairs(at(f, 3))) {
        if (alive.put(team(pair[0]), integer(pair[1])) != null) {
          throw new IllegalArgumentException("repeated team in pulse: " + pair[0]);
        }
      }
      var bombs = new TreeMap<String, Occurrence.Pulse.BombStatus>();
      for (var pair : pairs(at(f, 4))) {
        if (bombs.put(pair[0], Occurrence.Pulse.BombStatus.valueOf(pair[1])) != null) {
          throw new IllegalArgumentException("repeated bomb in pulse: " + pair[0]);
        }
      }
      return new Occurrence.Pulse(tick, alive, bombs, PoisonClock.Stage.valueOf(at(f, 2)));
    }

    private static List<String[]> pairs(String field) {
      if (field.isEmpty()) {
        return List.of();
      }
      var out = new ArrayList<String[]>();
      for (var part : field.split(",", -1)) {
        var pair = part.split("=", -1);
        if (pair.length != 2) {
          throw new IllegalArgumentException("not a key=value pair: " + part);
        }
        out.add(pair);
      }
      return out;
    }

    private static void exactly(String[] fields, int count) {
      if (fields.length != count) {
        throw new IllegalArgumentException(
            fields[0] + " rows have " + count + " fields, not " + fields.length);
      }
    }

    private static Optional<String> optional(String field) {
      return field.isEmpty() ? Optional.empty() : Optional.of(field);
    }

    private static Optional<String> noneable(String field) {
      return field.equals(NONE) ? Optional.empty() : Optional.of(field);
    }

    private static double decimal(String field) {
      try {
        return Double.parseDouble(field);
      } catch (NumberFormatException e) {
        throw new IllegalArgumentException("not a number: " + field, e);
      }
    }

    private InputFrame input(String[] f) {
      var version = version("input");
      if (f.length != (version == 2 ? 6 : 12)) {
        throw new IllegalArgumentException("wrong input field count for schema " + version);
      }
      if (version == 2) {
        return new InputFrame(
            new InputFrame.Legacy(
                num(at(f, 1)), at(f, 2), integer(at(f, 3)), integer(at(f, 4)), integer(at(f, 5))));
      }
      return new InputFrame(
          num(at(f, 1)),
          at(f, 2),
          integer(at(f, 3)),
          integer(at(f, 4)),
          integer(at(f, 5)),
          bool(at(f, 6)),
          bool(at(f, 7)),
          integer(at(f, 8)),
          num(at(f, 9)),
          num(at(f, 10)),
          InputFrame.Source.valueOf(at(f, 11)));
    }

    private static Frame frame(String[] f) {
      return new Frame(
          num(at(f, 1)),
          at(f, 2),
          integer(at(f, 3)),
          integer(at(f, 4)),
          integer(at(f, 5)),
          integer(at(f, 6)),
          integer(at(f, 7)),
          integer(at(f, 8)),
          integer(at(f, 9)),
          integer(at(f, 10)));
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
          inputs,
          observations,
          intents,
          occurrences,
          new RecordEnd(tail.tick(), tail.winner(), tail.reason(), payouts));
    }

    private static String at(String[] fields, int index) {
      if (index >= fields.length) {
        throw new IllegalArgumentException("row is missing field " + index);
      }
      return fields[index];
    }

    private static int integer(String field) {
      return Integer.parseInt(field);
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
