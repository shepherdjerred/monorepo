package com.shepherdjerred.thestorm.rwf.domain.kit;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.time.temporal.IsoFields;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.SplittableRandom;

/**
 * The bought kits anyone may play free this week. Each ISO week (Monday 00:00 UTC to the next)
 * offers {@link #SIZE} of them: one or two {@link KitTier#BASIC} kits and the rest {@link
 * KitTier#MID} or {@link KitTier#ADVANCED}, none of them free the week before. It is a pure
 * function of the week, the kits and a fixed seed, computed rather than scheduled: every server and
 * every replay agrees on it, and nothing has to run when the week turns.
 */
public final class KitRotation {

  /** How many bought kits are free each week. */
  public static final int SIZE = 4;

  /**
   * The Monday of the first rotation week, ISO 2026-W01. Weeks are chained from here so that no
   * week repeats a kit from the one before it; the week before it offered nothing.
   */
  public static final LocalDate EPOCH = LocalDate.of(2025, 12, 29);

  /**
   * The rotation's fixed seed. Changing it reshuffles every week's free kits, past and future, so
   * it never changes.
   */
  public static final long SEED = 0x5257465F4B495453L;

  private static final long WEEK_SALT = 0x9E3779B97F4A7C15L;

  private KitRotation() {}

  /**
   * One rotation week.
   *
   * @param monday the Monday it starts on (UTC)
   */
  public record Week(LocalDate monday) {

    public Week {
      if (monday.getDayOfWeek() != DayOfWeek.MONDAY) {
        throw new IllegalArgumentException("a rotation week starts on a Monday: " + monday);
      }
    }

    /** The week {@code now} falls in. */
    public static Week of(Instant now) {
      var date = LocalDate.ofInstant(now, ZoneOffset.UTC);
      return new Week(date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)));
    }

    public Week previous() {
      return new Week(monday.minusWeeks(1));
    }

    public Week next() {
      return new Week(monday.plusWeeks(1));
    }

    /** When the week ends and the next rotation starts. */
    public Instant endsAt() {
      return monday.plusWeeks(1).atStartOfDay(ZoneOffset.UTC).toInstant();
    }

    /** The ISO week number, 1 to 53, as players see it. */
    public int isoWeek() {
      return monday.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR);
    }

    /** The ISO week-based year. */
    public int isoYear() {
      return monday.get(IsoFields.WEEK_BASED_YEAR);
    }
  }

  /**
   * The kits free in {@code week}, in {@code kits}' (menu) order.
   *
   * @param week the week
   * @param kits every kit, in menu order; only bought kits rotate
   * @param seed the fixed rotation seed
   * @throws IllegalStateException when there are too few bought kits to fill a week without
   *     repeating the last
   */
  public static List<KitSpec> of(Week week, List<KitSpec> kits, long seed) {
    return ofOptional(week, kits, seed)
        .orElseThrow(
            () ->
                new IllegalStateException(
                    "too few bought kits to rotate " + SIZE + " a week without repeats"));
  }

  /** The rotation when the pool supports it, or empty when its tiers or repeats prevent one. */
  public static java.util.Optional<List<KitSpec>> ofOptional(
      Week week, List<KitSpec> kits, long seed) {
    var bought = kits.stream().filter(KitSpec::purchasable).toList();
    Set<String> previous = Set.of();
    var start = EPOCH.isAfter(week.monday()) ? week.monday() : EPOCH;
    var current = new Week(start);
    List<KitSpec> chosen = List.of();
    while (!current.monday().isAfter(week.monday())) {
      var next = pick(current, bought, previous, seed);
      if (next.isEmpty()) {
        return java.util.Optional.empty();
      }
      chosen = next.orElseThrow();
      previous = ids(chosen);
      current = current.next();
    }
    var order = kits.stream().map(KitSpec::id).toList();
    return java.util.Optional.of(
        chosen.stream().sorted(Comparator.comparingInt(kit -> order.indexOf(kit.id()))).toList());
  }

  /** The kits free in {@code week} under the fixed {@link #SEED}. */
  public static List<KitSpec> of(Week week, List<KitSpec> kits) {
    return of(week, kits, SEED);
  }

  /** The optional rotation in {@code week} under the fixed {@link #SEED}. */
  public static java.util.Optional<List<KitSpec>> ofOptional(Week week, List<KitSpec> kits) {
    return ofOptional(week, kits, SEED);
  }

  /** The ids of {@link #of}. */
  public static Set<String> ids(Week week, List<KitSpec> kits, long seed) {
    return ids(of(week, kits, seed));
  }

  private static Set<String> ids(List<KitSpec> kits) {
    var ids = new HashSet<String>();
    kits.forEach(kit -> ids.add(kit.id()));
    return Set.copyOf(ids);
  }

  private static java.util.Optional<List<KitSpec>> pick(
      Week week, List<KitSpec> bought, Set<String> previous, long seed) {
    var index = ChronoUnit.WEEKS.between(EPOCH, week.monday());
    var random = new SplittableRandom(seed ^ (index * WEEK_SALT));
    var basicCount = 1 + random.nextInt(2);
    var basics = new ArrayList<KitSpec>();
    var others = new ArrayList<KitSpec>();
    for (var kit : bought) {
      if (previous.contains(kit.id())) {
        continue;
      }
      (kit.tier() == KitTier.BASIC ? basics : others).add(kit);
    }
    shuffle(basics, random);
    shuffle(others, random);
    var otherCount = SIZE - basicCount;
    if (basics.size() < basicCount || others.size() < otherCount) {
      return java.util.Optional.empty();
    }
    var chosen = new ArrayList<KitSpec>(basics.subList(0, basicCount));
    chosen.addAll(others.subList(0, otherCount));
    return java.util.Optional.of(List.copyOf(chosen));
  }

  /** A Fisher-Yates shuffle driven by {@code random}, so the order is seeded. */
  private static void shuffle(List<KitSpec> kits, SplittableRandom random) {
    for (var i = kits.size() - 1; i > 0; i--) {
      var j = random.nextInt(i + 1);
      var held = kits.get(i);
      kits.set(i, kits.get(j));
      kits.set(j, held);
    }
  }
}
