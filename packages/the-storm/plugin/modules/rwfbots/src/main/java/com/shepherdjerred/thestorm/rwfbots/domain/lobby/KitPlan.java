package com.shepherdjerred.thestorm.rwfbots.domain.lobby;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;

/**
 * The kits a bot tries in the lobby, like a player making up their mind: the kit it picks as it
 * walks in, then up to {@link #MAX_SWITCHES} switches at least {@link #MIN_GAP} apart, the last of
 * them always to the kit the director drafted, so the match's balance never changes. A bot with no
 * time for a switch just picks its drafted kit.
 *
 * @param first the kit picked on arrival
 * @param switches the later picks, in order, each timed from arrival; the last is the drafted kit
 */
public record KitPlan(String first, List<Switch> switches) {

  /** The most kit switches a bot makes before the match. */
  public static final int MAX_SWITCHES = 3;

  /** The shortest time between two of a bot's picks. */
  public static final Duration MIN_GAP = Duration.ofSeconds(5);

  /** How much longer than {@link #MIN_GAP} a gap may run. */
  static final Duration JITTER = Duration.ofSeconds(4);

  /**
   * One later pick.
   *
   * @param after how long after arriving
   * @param kit the kit id
   */
  public record Switch(Duration after, String kit) {}

  public KitPlan {
    switches = List.copyOf(switches);
    if (switches.size() > MAX_SWITCHES) {
      throw new IllegalArgumentException("at most " + MAX_SWITCHES + " switches: " + switches);
    }
    var previous = Duration.ZERO;
    for (var change : switches) {
      if (change.after().minus(previous).compareTo(MIN_GAP) < 0) {
        throw new IllegalArgumentException("switches must be " + MIN_GAP + " apart: " + switches);
      }
      previous = change.after();
    }
  }

  /** The kit the bot ends on: its last switch, or its first pick when it never switches. */
  public String last() {
    return switches.isEmpty() ? first : switches.getLast().kit();
  }

  /**
   * The kits on offer and the one the director drafted.
   *
   * @param drafted the drafted kit, which the bot ends on
   * @param kits every kit a bot may pick, the drafted one among them
   */
  public record Choice(String drafted, List<String> kits) {

    public Choice {
      kits = List.copyOf(kits);
      if (!kits.contains(drafted)) {
        throw new IllegalArgumentException(drafted + " is not one of the kits " + kits);
      }
    }
  }

  /**
   * Plans a bot's picks within {@code window} of arriving: eager temperaments switch more; the
   * count shrinks until every gap is at least {@link #MIN_GAP}.
   */
  public static KitPlan plan(
      Choice choice, LobbyTemperament temperament, Duration window, RandomGenerator random) {
    var drafted = choice.drafted();
    var kits = choice.kits();
    var others = kits.stream().filter(kit -> !kit.equals(drafted)).toList();
    var wanted = wanted(temperament, random);
    var room = (int) Math.min(MAX_SWITCHES, window.toMillis() / MIN_GAP.toMillis());
    var count = others.isEmpty() ? 0 : Math.min(wanted, room);
    if (count == 0) {
      return new KitPlan(drafted, List.of());
    }
    var sequence = new ArrayList<String>();
    sequence.add(others.get(random.nextInt(others.size())));
    for (var i = 1; i < count; i++) {
      var previous = sequence.getLast();
      var last = i == count - 1;
      // The detour before the final switch is never the drafted kit, so that switch is real.
      var choices =
          kits.stream()
              .filter(kit -> !kit.equals(previous) && !(last && kit.equals(drafted)))
              .toList();
      if (choices.isEmpty()) {
        break;
      }
      sequence.add(choices.get(random.nextInt(choices.size())));
    }
    sequence.add(drafted);
    return new KitPlan(
        sequence.getFirst(), timed(sequence.subList(1, sequence.size()), window, random));
  }

  /** How many switches the temperament wants: 0 to {@link #MAX_SWITCHES}. */
  static int wanted(LobbyTemperament temperament, RandomGenerator random) {
    var count = 0;
    for (var i = 0; i < MAX_SWITCHES; i++) {
      if (random.nextDouble() < temperament.switchBias()) {
        count++;
      }
    }
    return count;
  }

  /** Spaces {@code kits} at least {@link #MIN_GAP} apart, the last no later than {@code window}. */
  private static List<Switch> timed(List<String> kits, Duration window, RandomGenerator random) {
    var gaps = new ArrayList<Long>();
    var total = 0L;
    for (var i = 0; i < kits.size(); i++) {
      var gap = MIN_GAP.toMillis() + random.nextLong(JITTER.toMillis() + 1);
      gaps.add(gap);
      total += gap;
    }
    var spare = window.toMillis() - kits.size() * MIN_GAP.toMillis();
    var extra = total - kits.size() * MIN_GAP.toMillis();
    var scale = extra > spare ? spare / (double) extra : 1;
    var switches = new ArrayList<Switch>();
    var at = 0L;
    for (var i = 0; i < kits.size(); i++) {
      at += MIN_GAP.toMillis() + (long) Math.floor((gaps.get(i) - MIN_GAP.toMillis()) * scale);
      switches.add(new Switch(Duration.ofMillis(at), kits.get(i)));
    }
    return switches;
  }
}
