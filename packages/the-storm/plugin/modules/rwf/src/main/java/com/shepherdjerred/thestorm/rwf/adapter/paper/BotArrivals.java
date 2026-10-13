package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.lobby.Arrivals;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.List;
import java.util.function.Consumer;
import java.util.function.Predicate;

/**
 * Drafted bots on their way into the lobby, each walking in at its own moment of the countdown.
 * Main thread only.
 */
final class BotArrivals {

  /**
   * Drafted bots arrive in the first half of what is left of the countdown, leaving time for
   * admission and kit choice.
   */
  static final double ARRIVAL_SHARE = 0.5;

  /** Mixed into the match seed for the arrival schedule, so it differs from the other rolls. */
  private static final long ARRIVAL_SALT = 0x6C6F6262795F696EL;

  /**
   * A drafted bot on its way into the lobby.
   *
   * @param bot the bot
   * @param at when it walks in
   */
  private record Arrival(CombatantId.Bot bot, Instant at) {}

  private final ArrayDeque<Arrival> arriving = new ArrayDeque<>();
  private final Consumer<CombatantId.Bot> release;

  /**
   * @param release sends a bot that never walked in back to the roster
   */
  BotArrivals(Consumer<CombatantId.Bot> release) {
    this.release = release;
  }

  /**
   * Schedules {@code drafted} over {@code budget} from {@code now}, in an order seeded by the
   * match.
   */
  void schedule(List<CombatantId.Bot> drafted, long seed, Instant now, Duration budget) {
    var offsets = Arrivals.offsets(drafted.size(), seed ^ ARRIVAL_SALT, budget);
    for (var i = 0; i < drafted.size(); i++) {
      arriving.add(new Arrival(drafted.get(i), now.plus(offsets.get(i))));
    }
  }

  /** Bots whose time has come walk in through {@code join}, which says whether they did. */
  void arrive(Instant now, Predicate<CombatantId.Bot> join) {
    while (!arriving.isEmpty() && !arriving.peek().at().isAfter(now)) {
      var _ = join.test(arriving.poll().bot());
    }
  }

  /** Bots that have not walked in yet go back to the roster. */
  void release() {
    while (!arriving.isEmpty()) {
      release.accept(arriving.poll().bot());
    }
  }

  /** How many drafted bots are still on their way in. */
  int size() {
    return arriving.size();
  }
}
