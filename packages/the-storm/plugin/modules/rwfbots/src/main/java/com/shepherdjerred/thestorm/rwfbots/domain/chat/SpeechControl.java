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

  public static Duration reaction(RandomGenerator random) {
    return Duration.ofMillis(random.nextLong(400, 901));
  }

  public static Duration typing(String text, RandomGenerator random) {
    var millis =
        Math.round(text.codePointCount(0, text.length()) * 1000.0 / random.nextDouble(5, 9));
    return Duration.ofMillis(Math.clamp(millis, 800, 4000));
  }

  /** Commits a delivered message; rejected lines are dropped instead of queued until stale. */
  public boolean deliver(UUID speaker, Optional<String> team, String text, Instant now) {
    if (!ready(speaker, team, text, now)) return false;
    if (team.isEmpty()) global = now;
    else {
      var lines = teamLines.computeIfAbsent(team.orElseThrow(), ignored -> new ArrayDeque<>());
      while (!lines.isEmpty() && !lines.peekFirst().isAfter(now.minusSeconds(15)))
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
    var key = team.orElse("global") + ":" + text;
    var duplicate = repeated.get(key);
    if (duplicate != null && now.isBefore(duplicate.plusSeconds(12))) return false;
    var personal = team.isPresent() ? tactical : casual;
    var last = personal.get(speaker);
    var seconds = team.isPresent() ? 15 : 45;
    if (last != null && now.isBefore(last.plusSeconds(seconds))) return false;
    return remaining(team, now) > 0;
  }

  public int remaining(Optional<String> team, Instant now) {
    if (team.isEmpty()) return now.isBefore(global.plusSeconds(20)) ? 0 : 1;
    var lines = teamLines.get(team.orElseThrow());
    return lines == null
        ? 2
        : 2 - (int) lines.stream().filter(at -> at.isAfter(now.minusSeconds(15))).count();
  }
}
