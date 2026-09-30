package com.shepherdjerred.thestorm.agent.app;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Who asked what, and when: the repeat-asker memory behind three-strike cutting. A hit is
 * remembered while it is younger than the configured half-life and forgotten after, so a question
 * from last season never cuts and one from this morning always does. Counting remembered hits
 * instead of summing decayed weights keeps the boundary exact: two fresh hits always cut, no matter
 * how many seconds passed between them. Thread-safe: ticket events arrive while flows read from
 * wherever they run.
 */
public final class FaqMemory {

  /** Hits older than this many half-lives weigh nothing worth keeping. */
  static final int PRUNE_HALF_LIVES = 10;

  private final Map<UUID, Map<String, List<Instant>>> hits = new HashMap<>();

  /** {@code player}'s remembered hits for {@code entryId} at {@code now}. */
  public synchronized int strikes(UUID player, String entryId, Instant now, Duration halfLife) {
    var mine = hits.getOrDefault(player, Map.of()).getOrDefault(entryId, List.of());
    var count = 0;
    for (var hit : mine) {
      if (Duration.between(hit, now).compareTo(halfLife) < 0) {
        count++;
      }
    }
    return count;
  }

  /** Remembers that {@code player} got {@code entryId} at {@code now}, pruning dead weight. */
  public synchronized void recordHit(UUID player, String entryId, Instant now, Duration halfLife) {
    var mine = hits.computeIfAbsent(player, _ -> new HashMap<>());
    var entry = mine.computeIfAbsent(entryId, _ -> new ArrayList<>());
    entry.add(now);
    var cutoff = now.minus(halfLife.multipliedBy(PRUNE_HALF_LIVES));
    entry.removeIf(hit -> hit.isBefore(cutoff));
    if (entry.isEmpty()) {
      mine.remove(entryId);
    }
    if (mine.isEmpty()) {
      hits.remove(player);
    }
  }
}
