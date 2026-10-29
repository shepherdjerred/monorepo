package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.random.RandomGenerator;

/** Human typing time and delivery limits shared by authored lines and tactical calls. */
public final class SpeechControl {
  private final Map<UUID, Instant> casual = new HashMap<>();
  private final Map<UUID, Instant> tactical = new HashMap<>();
  private final Map<String, ArrayDeque<Instant>> teamLines = new HashMap<>();
  private final Map<String, Instant> repeated = new HashMap<>();
  private Instant global = Instant.MIN;

  /** The team budget's window, and a bot's wait between two sightings it calls. */
  static final int WINDOW_SECONDS = 15;

  /** Sightings a team calls per window. */
  static final int TEAM_LINES = 2;

  /** Lines a team says per window counting urgent calls. */
  static final int URGENT_TEAM_LINES = 4;

  /** A bot's wait between an urgent call and its previous team line. */
  static final int URGENT_GAP_SECONDS = 4;

  public static Duration reaction(RandomGenerator random) {
    return Duration.ofMillis(random.nextLong(400, 901));
  }

  public static Duration typing(String text, RandomGenerator random) {
    var millis =
        Math.round(text.codePointCount(0, text.length()) * 1000.0 / random.nextDouble(5, 9));
    return Duration.ofMillis(Math.clamp(millis, 800, 4000));
  }

  /**
   * One line to say.
   *
   * @param speaker the bot
   * @param team the team chat it goes to, or empty for Global
   * @param text what it says
   * @param urgent whether it is a team call about the objective or a teammate in need, which has a
   *     larger team budget and a shorter personal wait than a sighting
   */
  public record Line(UUID speaker, Optional<String> team, String text, boolean urgent) {}

  /** Commits a delivered message; rejected lines are dropped instead of queued until stale. */
  public boolean deliver(UUID speaker, Optional<String> team, String text, Instant now) {
    return deliver(new Line(speaker, team, text, false), now);
  }

  /** Commits a delivered {@code line}; rejected lines are dropped instead of queued until stale. */
  public boolean deliver(Line line, Instant now) {
    if (!ready(line, now)) return false;
    var speaker = line.speaker();
    var team = line.team();
    var text = line.text();
    if (team.isEmpty()) global = now;
    else {
      var lines = teamLines.computeIfAbsent(team.orElseThrow(), ignored -> new ArrayDeque<>());
      while (!lines.isEmpty() && !lines.peekFirst().isAfter(now.minusSeconds(WINDOW_SECONDS)))
        lines.removeFirst();
      lines.addLast(now);
    }
    (team.isPresent() ? tactical : casual).put(speaker, now);
    repeated.entrySet().removeIf(entry -> !entry.getValue().isAfter(now.minusSeconds(12)));
    repeated.put(team.orElse("global") + ":" + text, now);
    return true;
  }

  /** Avoid starting a typing pause for a line that is already known to exceed its budget. */
  public boolean ready(UUID speaker, Optional<String> team, String text, Instant now) {
    return ready(new Line(speaker, team, text, false), now);
  }

  /** Whether {@code line} may start now, within its budget and its speaker's wait. */
  public boolean ready(Line line, Instant now) {
    var team = line.team();
    var key = team.orElse("global") + ":" + line.text();
    var duplicate = repeated.get(key);
    if (duplicate != null && now.isBefore(duplicate.plusSeconds(12))) return false;
    var personal = team.isPresent() ? tactical : casual;
    var last = personal.get(line.speaker());
    var seconds = team.isEmpty() ? 45 : line.urgent() ? URGENT_GAP_SECONDS : WINDOW_SECONDS;
    if (last != null && now.isBefore(last.plusSeconds(seconds))) return false;
    return remaining(team, now, line.urgent()) > 0;
  }

  public int remaining(Optional<String> team, Instant now) {
    return remaining(team, now, false);
  }

  /**
   * How many more lines fit the budget now: one Global line per 20 seconds; per team {@link
   * #TEAM_LINES} sightings, or {@link #URGENT_TEAM_LINES} lines when urgent, per {@link
   * #WINDOW_SECONDS}. Urgent calls count against the sightings' budget, so they go first.
   */
  public int remaining(Optional<String> team, Instant now, boolean urgent) {
    if (team.isEmpty()) return now.isBefore(global.plusSeconds(20)) ? 0 : 1;
    var budget = urgent ? URGENT_TEAM_LINES : TEAM_LINES;
    var lines = teamLines.get(team.orElseThrow());
    return lines == null
        ? budget
        : budget
            - (int)
                lines.stream().filter(at -> at.isAfter(now.minusSeconds(WINDOW_SECONDS))).count();
  }
}
