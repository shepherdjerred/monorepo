package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import static com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion.PromotionGates.require;

import com.shepherdjerred.thestorm.rwfbots.app.learning.BatchedInference;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;

/** Reconstructs the frozen load windows from all original command replies. */
final class PromotionLoad {
  private static final Wire WIRE = wire();

  private PromotionLoad() {}

  record Tick(
      long serverTick,
      double milliseconds,
      String match,
      long botTick,
      int alive,
      int observed,
      int applied,
      int unavailable,
      int ineligible,
      boolean live) {}

  record Sample(
      int protocol,
      String contract,
      boolean ready,
      String result,
      String phase,
      String match,
      int seed,
      int bots,
      List<Tick> ticks,
      List<Long> ages,
      long damageEvents,
      double damage,
      BatchedInference.Metrics inference) {}

  record Match(int seed, String match) {}

  record Phase(int bots, List<Tick> ticks, List<Match> matches, Sample before, Sample after) {}

  record Measurements(List<Tick> baseline, List<Phase> phases) {}

  record Entry(int phase, String command, Sample state) {}

  record Wire(
      int version,
      String contract,
      List<String> results,
      List<String> phases,
      List<String> required,
      List<String> optional,
      List<String> tickFields,
      List<String> inferenceFields) {}

  private static Wire wire() {
    var stream = PromotionLoad.class.getResourceAsStream("/rwf-inference-load.json");
    if (stream == null) throw new IllegalStateException("missing native load wire contract");
    try (stream) {
      var wire = PromotionContract.JSON.readValue(stream.readAllBytes(), Wire.class);
      var sampleFields = new ArrayList<>(wire.required());
      sampleFields.addAll(wire.optional());
      require(
          wire.version() == 1 && wire.contract().equals("rwf-inference-load-v1"),
          "load wire version");
      require(
          fields(Sample.class).equals(sampleFields)
              && fields(Tick.class).equals(wire.tickFields())
              && fields(BatchedInference.Metrics.class).equals(wire.inferenceFields()),
          "load wire field inventory");
      return wire;
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }

  private static List<String> fields(Class<?> type) {
    return java.util.Arrays.stream(type.getRecordComponents())
        .map(java.lang.reflect.RecordComponent::getName)
        .toList();
  }

  static void validate(PromotionFiles files, PromotionProof.Load facts) throws IOException {
    var measured =
        PromotionContract.JSON.readValue(
            Files.readAllBytes(files.path(facts.phases_sha256())), Measurements.class);
    var groups = groups(files, facts.log_sha256());
    require(groups.size() == 4, "load command phase inventory");
    var baseline = window(0, groups.getFirst(), 700_000_000);
    require(
        baseline.ticks().equals(measured.baseline())
            && measured.baseline().size() == facts.baseline_ticks(),
        "raw load baseline");
    require(percentile(measured.baseline()) == facts.baseline_p95(), "recomputed baseline p95");
    require(measured.phases().size() == 3, "raw load populations");
    int seed = 700_000_000;
    var identities = new HashSet<String>();
    var previous = baseline.after();
    for (int index = 0; index < 3; index++) {
      var phase = measured.phases().get(index);
      var summary = facts.phases().get(index);
      require(phase.bots() == summary.bots(), "raw load population");
      counters(previous, phase.before());
      var reconstructed = window(phase.bots(), groups.get(index + 1), seed);
      require(reconstructed.equals(phase), "load measurements differ from complete command stream");
      seed += phase.matches().size();
      previous = phase.after();
      for (var match : phase.matches())
        require(identities.add(match.match()), "distinct load match identities");
      summary(phase, summary);
    }
  }

  private static List<List<Entry>> groups(PromotionFiles files, String digest) throws IOException {
    var groups = new ArrayList<List<Entry>>();
    try (var lines = Files.lines(files.path(digest))) {
      for (var iterator = lines.iterator(); iterator.hasNext(); ) {
        var entry = PromotionContract.JSON.readValue(iterator.next(), Entry.class);
        if (groups.isEmpty() || groups.getLast().getFirst().phase() != entry.phase())
          groups.add(new ArrayList<>());
        groups.getLast().add(entry);
      }
    }
    require(
        groups.stream()
            .map(group -> group.getFirst().phase())
            .toList()
            .equals(List.of(0, 20, 50, 100)),
        "ordered load command phases");
    return groups;
  }

  private static Phase window(int bots, List<Entry> entries, int firstSeed) {
    var first = entries.getFirst();
    var last = entries.getLast();
    require(
        first.command().equals("window start")
            && last.command().equals("window stop")
            && first.state().phase().equals("LOBBY")
            && first.state().match().isEmpty(),
        "load window boundaries");
    var inference = first.state().inference();
    require(
        Math.addExact(inference.deadlineMet(), inference.deadlineMissed()) == inference.submitted(),
        "drained load window start");
    var previous = first.state();
    var matches = new ArrayList<Match>();
    var ticks = new ArrayList<Tick>();
    for (int index = 0; index < entries.size(); index++) {
      var entry = entries.get(index);
      sample(entry.state(), bots);
      counters(previous, entry.state());
      previous = entry.state();
      ticks.addAll(entry.state().ticks());
      if (index == 0 || index == entries.size() - 1 || entry.command().equals("sample")) continue;
      int seed = firstSeed + matches.size();
      require(
          bots != 0
              && entry.command().equals("begin " + bots + " " + seed)
              && entry.state().seed() == seed
              && entry.state().bots() == bots
              && !entry.state().match().isEmpty(),
          "original load match schedule");
      matches.add(new Match(seed, entry.state().match()));
    }
    require(bots == 0 || (!matches.isEmpty() && matches.size() <= 30), "load match coverage");
    ticks(bots, ticks, matches);
    return new Phase(bots, ticks, matches, first.state(), last.state());
  }

  private static void sample(Sample sample, int bots) {
    require(
        sample.protocol() == 1
            && sample.contract().equals("rwf-inference-load-v1")
            && sample.ready()
            && sample.bots() >= 0
            && sample.bots() <= bots
            && sample.seed() >= 0
            && sample.seed() <= 1_000_000_000
            && sample.ticks().size() <= 2000,
        "raw load sample contract");
    require(
        WIRE.results().contains(sample.result()) && WIRE.phases().contains(sample.phase()),
        "raw load sample phase");
    identity(sample.match(), true);
    require(
        sample.ages().size() == 3 && sample.ages().stream().allMatch(age -> age >= 0),
        "raw load action ages");
    require(
        Double.isFinite(sample.damage()) && sample.damage() >= 0 && sample.damageEvents() >= 0,
        "raw load damage");
  }

  private static void counters(Sample before, Sample after) {
    var first = PromotionContract.JSON.valueToTree(before.inference());
    var last = PromotionContract.JSON.valueToTree(after.inference());
    for (var entry : last.properties()) {
      var value = entry.getValue().asLong();
      require(
          value >= 0 && value >= first.path(entry.getKey()).asLong(),
          "monotonic load inference counters");
    }
    require(
        after.damage() >= before.damage() && after.damageEvents() >= before.damageEvents(),
        "monotonic load damage");
    for (int index = 0; index < after.ages().size(); index++)
      require(after.ages().get(index) >= before.ages().get(index), "monotonic load ages");
    require(
        Math.addExact(after.inference().deadlineMet(), after.inference().deadlineMissed())
            <= after.inference().submitted(),
        "raw load completion accounting");
  }

  private static void ticks(int bots, List<Tick> ticks, List<Match> matches) {
    long previous = -1;
    for (var tick : ticks) {
      require(
          tick.serverTick() >= 0
              && (previous == -1 || tick.serverTick() == previous + 1)
              && tick.botTick() >= 0,
          "consecutive raw server ticks");
      previous = tick.serverTick();
      require(
          Double.isFinite(tick.milliseconds()) && tick.milliseconds() >= 0,
          "finite raw tick duration");
      body(tick, bots);
      identity(tick.match(), true);
      if (tick.live())
        require(
            matches.stream().anyMatch(match -> match.match().equals(tick.match())),
            "load tick match identity");
      if (bots == 0) require(!tick.live() && tick.match().isEmpty(), "empty lobby load baseline");
    }
  }

  private static void body(Tick tick, int bots) {
    require(
        tick.alive() >= 0
            && tick.alive() <= bots
            && tick.observed() >= 0
            && tick.observed() <= tick.alive(),
        "raw load body population");
    require(
        tick.applied() >= 0
            && tick.unavailable() >= 0
            && tick.ineligible() >= 0
            && (long) tick.applied() + tick.unavailable() + tick.ineligible() == tick.observed(),
        "raw load action accounting");
  }

  private static void identity(String match, boolean allowEmpty) {
    if (allowEmpty && match.isEmpty()) return;
    require(UUID.fromString(match).toString().equals(match), "canonical load match identity");
  }

  private static void summary(Phase phase, PromotionProof.Population facts) {
    var live = phase.ticks().stream().filter(Tick::live).toList();
    var full =
        live.stream()
            .filter(tick -> tick.alive() == phase.bots() && tick.observed() == phase.bots())
            .toList();
    require(
        phase.ticks().size() == facts.ticks()
            && live.size() == facts.live_ticks()
            && full.size() == facts.full_roster_ticks(),
        "recomputed load coverage");
    require(
        percentile(phase.ticks()) == facts.p95()
            && percentile(live) == facts.live_p95()
            && percentile(full) == facts.full_roster_p95(),
        "recomputed load p95");
    var before = phase.before().inference();
    var after = phase.after().inference();
    require(
        after.submitted() - before.submitted() == facts.submitted()
            && after.skipped() - before.skipped() == facts.skipped()
            && after.rejected() - before.rejected() == facts.rejected(),
        "recomputed load attempts");
    require(
        after.deadlineMet() - before.deadlineMet() == facts.deadline_met()
            && after.deadlineMissed() - before.deadlineMissed() == facts.deadline_missed()
            && after.maximumBatch() == facts.maximum_batch(),
        "recomputed load deadlines");
    long applied = live.stream().mapToLong(Tick::applied).sum();
    long ages = 0;
    for (int index = 0; index < 3; index++)
      ages =
          Math.addExact(ages, phase.after().ages().get(index) - phase.before().ages().get(index));
    require(applied == facts.applied() && ages == applied, "recomputed load action delivery");
    require(
        phase.after().damage() - phase.before().damage() == facts.damage()
            && phase.after().damageEvents() - phase.before().damageEvents()
                == facts.damage_events(),
        "recomputed native load damage");
  }

  private static double percentile(List<Tick> ticks) {
    require(!ticks.isEmpty(), "nonempty load tick population");
    var sorted = ticks.stream().mapToDouble(Tick::milliseconds).sorted().toArray();
    return sorted[(int) Math.ceil(sorted.length * 0.95) - 1];
  }
}
