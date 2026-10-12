package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** Main-thread interval diagnostics. Explicit reset separates startup, settling and measurement. */
public final class LoadTelemetry {
  private final long[] ages = new long[65_536];
  private final long[] lags = new long[4_096];
  private final Map<CombatantId, Long> awaiting = new HashMap<>();
  private int ageCount;
  private int lagCount;
  private int ageNext;
  private int lagNext;
  private long maximumAge;
  private int pendingMaximum;
  private int governorMaximum;
  private long overrunBaseline;
  private long beganTick = -1;
  private long lastBoardTick;
  private long heapPeak;
  private long heapLimit;

  public void reset(long overruns) {
    ageCount = 0;
    lagCount = 0;
    ageNext = 0;
    lagNext = 0;
    maximumAge = 0;
    pendingMaximum = 0;
    governorMaximum = 0;
    overrunBaseline = overruns;
    beganTick = -1;
    lastBoardTick = 0;
    heapPeak = 0;
    heapLimit = 0;
  }

  public void memory(long used, long limit) {
    heapPeak = Math.max(heapPeak, used);
    heapLimit = limit;
  }

  /** Samples all living registered bots even when the worker has published no board yet. */
  public void record(
      WorldSnapshot snapshot, DecisionBoard board, Iterable<BotProfile> profiles, int level) {
    if (board.tick() < lastBoardTick) {
      beganTick = -1;
      awaiting.clear();
    }
    lastBoardTick = board.tick();
    if (beganTick < 0) beganTick = snapshot.tick();
    var pending = 0;
    for (var profile : profiles) {
      var self = snapshot.combatant(profile.id());
      if (self.isEmpty() || !self.orElseThrow().alive()) continue;
      var observation = board.perceptions().get(profile.id());
      var age = age(profile.id(), observation, snapshot.tick());
      if (observation == null || observation.pending()) pending++;
      ages[ageNext] = age;
      ageNext = (ageNext + 1) % ages.length;
      ageCount = Math.min(ageCount + 1, ages.length);
      maximumAge = Math.max(maximumAge, age);
    }
    lags[lagNext] =
        board.equals(DecisionBoard.EMPTY)
            ? snapshot.tick() - beganTick
            : snapshot.tick() - board.tick();
    lagNext = (lagNext + 1) % lags.length;
    lagCount = Math.min(lagCount + 1, lags.length);
    pendingMaximum = Math.max(pendingMaximum, pending);
    governorMaximum = Math.max(governorMaximum, level);
  }

  private long age(CombatantId id, @Nullable PerceptionAge observation, long tick) {
    if (observation == null) return tick - awaiting.computeIfAbsent(id, ignored -> tick);
    if (!observation.pending()) awaiting.remove(id);
    return observation.at(tick);
  }

  public record Sample(
      long observations,
      long ageP95,
      long ageMax,
      int pendingMax,
      long lagP95,
      int governorMax,
      long overruns,
      long heapPeak,
      long heapLimit) {}

  public Sample sample(long overruns) {
    return new Sample(
        ageCount,
        p95(ages, ageCount),
        maximumAge,
        pendingMaximum,
        p95(lags, lagCount),
        governorMaximum,
        overruns - overrunBaseline,
        heapPeak,
        heapLimit);
  }

  /** Use one captured worker count for both boundaries, so no intervening job is discarded. */
  public Sample drain(long overruns) {
    var measured = sample(overruns);
    reset(overruns);
    return measured;
  }

  private static long p95(long[] values, int count) {
    if (count == 0) return 0;
    var sorted = Arrays.copyOf(values, count);
    Arrays.sort(sorted);
    return sorted[(int) Math.ceil(count * 0.95) - 1];
  }
}
