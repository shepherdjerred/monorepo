package com.shepherdjerred.thestorm.shops.app;

import static java.util.concurrent.CompletableFuture.completedFuture;

import com.shepherdjerred.thestorm.shops.domain.catalog.DailyAllowance;
import java.time.InstantSource;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;

/**
 * How much each player has traded with each catalog today, counted in memory on the main thread. A
 * player's counts are read from the trade log once per day (on join, or on their first catalog
 * trade) and then only ever added to as trades settle, so two quick trades can never both pass a
 * limit the log has not caught up with. Entries are kept until the day changes (one small map per
 * player), so leaving and rejoining never re-reads a log that is still being written.
 *
 * <p>A trade whose log write fails is still counted here (the failure is logged), so the limit
 * holds for the rest of the day. After a restart the counts come from the log alone, so such a
 * trade would no longer count: a known, logged gap. Main thread only.
 */
public final class DailyUsage {

  private final ShopStore store;
  private final InstantSource time;
  private final ZoneId zone;
  private final Executor mainThread;
  private final Map<UUID, Day> players = new HashMap<>();

  /**
   * One player's counts for one day.
   *
   * @param date the day, in the reset zone
   * @param used items traded per catalog, item and direction
   */
  private record Day(LocalDate date, Map<ShopStore.UsageKey, Integer> used) {}

  public DailyUsage(ShopStore store, InstantSource time, ZoneId zone, Executor mainThread) {
    this.store = store;
    this.time = time;
    this.zone = zone;
    this.mainThread = mainThread;
  }

  /** How many items {@code player} has traded under {@code key} today; completes on main. */
  public CompletableFuture<Integer> used(UUID player, ShopStore.UsageKey key) {
    return load(player).thenApply(day -> day.used().getOrDefault(key, 0));
  }

  /**
   * Reads {@code player}'s counts for today if they are not in memory yet.
   *
   * @return completes on the main thread once they are
   */
  public CompletableFuture<Boolean> preload(UUID player) {
    return load(player).thenApply(day -> true);
  }

  /** Counts a settled trade. Main thread. */
  public void add(UUID player, ShopStore.UsageKey key, int quantity) {
    var today = today();
    var day = players.get(player);
    if (day == null || !day.date().equals(today)) {
      // Every trade loads the day first, so this only happens when the day turned over mid-trade:
      // this trade is the first one of the new day.
      day = new Day(today, new HashMap<>());
      players.put(player, day);
    }
    day.used().merge(key, quantity, Integer::sum);
  }

  private CompletableFuture<Day> load(UUID player) {
    var today = today();
    var cached = players.get(player);
    if (cached != null && cached.date().equals(today)) {
      return completedFuture(cached);
    }
    var since = DailyAllowance.dayStart(time.instant(), zone);
    return store
        .catalogUsageSince(player, since)
        .thenApplyAsync(
            used -> {
              // Another load may have finished first and counted trades since; keep that one.
              var current = players.get(player);
              if (current != null && current.date().equals(today)) {
                return current;
              }
              var day = new Day(today, new HashMap<>(used));
              players.put(player, day);
              return day;
            },
            mainThread);
  }

  private LocalDate today() {
    return LocalDate.ofInstant(time.instant(), zone);
  }
}
