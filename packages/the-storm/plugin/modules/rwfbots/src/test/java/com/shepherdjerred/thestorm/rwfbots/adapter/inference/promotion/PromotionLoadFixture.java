package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import com.shepherdjerred.thestorm.rwfbots.app.learning.BatchedInference;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Deterministic synthetic accounting, never performance or native gameplay evidence. */
final class PromotionLoadFixture {
  private long serverTick;
  private long submitted;
  private int roster;
  private int seed;
  private String match = "";
  private boolean live;
  private final List<PromotionLoad.Entry> entries = new ArrayList<>();
  final PromotionLoad.Measurements measurements;

  PromotionLoadFixture() {
    entry(0, "window start", List.of());
    var baseline = ticks(1800);
    entry(0, "sample", baseline);
    entry(0, "window stop", List.of());
    var phases = new ArrayList<PromotionLoad.Phase>();
    for (int bots : List.of(20, 50, 100)) {
      live = false;
      match = "";
      var before = entry(bots, "window start", List.of());
      seed = 700_000_000 + phases.size();
      roster = bots;
      match = new UUID(1, seed).toString();
      entry(bots, "begin " + bots + " " + seed, List.of());
      live = true;
      var ticks = new ArrayList<PromotionLoad.Tick>();
      for (int chunk = 0; chunk < 2; chunk++) {
        var added = ticks(1500);
        submitted += (long) added.size() * bots;
        ticks.addAll(added);
        entry(bots, "sample", added);
      }
      var after = entry(bots, "window stop", List.of());
      phases.add(
          new PromotionLoad.Phase(
              bots, ticks, List.of(new PromotionLoad.Match(seed, match)), before, after));
    }
    measurements = new PromotionLoad.Measurements(baseline, phases);
  }

  private List<PromotionLoad.Tick> ticks(int count) {
    var ticks = new ArrayList<PromotionLoad.Tick>();
    for (int index = 0; index < count; index++)
      ticks.add(
          new PromotionLoad.Tick(
              ++serverTick,
              20,
              match,
              live ? serverTick : 0,
              live ? roster : 0,
              live ? roster : 0,
              live ? roster : 0,
              0,
              0,
              live));
    return ticks;
  }

  private PromotionLoad.Sample entry(int phase, String command, List<PromotionLoad.Tick> ticks) {
    var inference =
        new BatchedInference.Metrics(
            submitted,
            0,
            submitted,
            0,
            0,
            0,
            submitted,
            0,
            0,
            0,
            submitted,
            0,
            submitted > 0 ? 1_000_000 : 0,
            roster);
    var sample =
        new PromotionLoad.Sample(
            1,
            "rwf-inference-load-v1",
            true,
            live ? "live" : "idle",
            live ? "LIVE" : match.isEmpty() ? "LOBBY" : "COUNTDOWN",
            match,
            seed,
            roster,
            ticks,
            List.of(0L, submitted, 0L),
            submitted / 100,
            submitted / 100.0,
            inference);
    entries.add(new PromotionLoad.Entry(phase, command, sample));
    return sample;
  }

  String log() {
    var text = new StringBuilder();
    for (var entry : entries)
      text.append(PromotionContract.JSON.writeValueAsString(entry)).append('\n');
    return text.toString();
  }
}
