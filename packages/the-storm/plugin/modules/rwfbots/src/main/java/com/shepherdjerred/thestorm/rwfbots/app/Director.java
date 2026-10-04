package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.director.Draft;
import com.shepherdjerred.thestorm.rwfbots.domain.director.MatchShift;
import com.shepherdjerred.thestorm.rwfbots.domain.director.Participant;
import com.shepherdjerred.thestorm.rwfbots.domain.director.Rating;
import com.shepherdjerred.thestorm.rwfbots.domain.director.SkillScale;
import com.shepherdjerred.thestorm.rwfbots.domain.director.TeamBalancer;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.PersonalityCatalog;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.random.RandomGenerator;

/**
 * Fills a match with bots: drafts personalities from the catalog, keeps the draft whose balanced
 * teams would be closest, shifts every bot's skill so the median bot sits a little under the median
 * human, and gives each bot a kit from its preferences. Pure: the same request and random source
 * always pick the same bots.
 */
public final class Director {

  /** How many drafts are tried before the most balanceable is kept. */
  public static final int CANDIDATE_DRAFTS = 4;

  private Director() {}

  /**
   * What the director works from.
   *
   * @param catalog every personality
   * @param botRatings the stored rating of each personality that has one
   * @param humanRatings the humans in the lobby
   * @param slots how many bots are wanted
   * @param excludedNames in-game names that must not be drafted (the humans online), any case
   * @param availableKits the kits the match can hand out
   * @param teamCount how many teams the map fields
   */
  public record Request(
      PersonalityCatalog catalog,
      Map<String, Rating> botRatings,
      List<Rating> humanRatings,
      int slots,
      Set<String> excludedNames,
      Set<Kit> availableKits,
      int teamCount) {

    public Request {
      botRatings = Map.copyOf(botRatings);
      humanRatings = List.copyOf(humanRatings);
      excludedNames =
          Set.copyOf(excludedNames.stream().map(n -> n.toLowerCase(Locale.ROOT)).toList());
      availableKits = Set.copyOf(availableKits);
      if (slots < 0 || teamCount < 2) {
        throw new IllegalArgumentException("slots must not be negative and teams at least two");
      }
      if (availableKits.isEmpty()) {
        throw new IllegalArgumentException("at least one kit must be available");
      }
    }

    /** The personalities that may be drafted: active, not a human's name, with a kit to play. */
    public List<Personality> pool() {
      return catalog.active().stream()
          .filter(p -> !excludedNames.contains(p.name().toLowerCase(Locale.ROOT)))
          .filter(p -> p.kits().keySet().stream().anyMatch(availableKits::contains))
          .toList();
    }

    /** The rating a personality plays at: its stored one, or a newcomer's at its base skill. */
    public Rating ratingOf(Personality personality) {
      var stored = botRatings.get(personality.id());
      return stored != null
          ? stored
          : new Rating(SkillScale.toMu(personality.skill()), Rating.DEFAULT.sigma());
    }
  }

  /**
   * One drafted bot.
   *
   * @param personality who
   * @param kit the kit it plays
   * @param levers its levers for this match, after the shift
   * @param rating the rating it plays at
   */
  public record Drafted(Personality personality, Kit kit, Levers levers, Rating rating) {}

  /**
   * The outcome of a draft.
   *
   * @param bots the bots, fewer than asked when the pool is short
   * @param shift the skill shift applied to every bot
   */
  public record Pick(List<Drafted> bots, double shift) {

    public Pick {
      bots = List.copyOf(bots);
    }
  }

  public static Pick pick(Request request, RandomGenerator random) {
    var pool = request.pool();
    var count = Math.min(request.slots(), pool.size());
    if (count == 0) {
      return new Pick(List.of(), 0);
    }
    var catalog = new PersonalityCatalog(pool);
    List<Personality> best = List.of();
    var bestSpread = Double.POSITIVE_INFINITY;
    for (var attempt = 0; attempt < CANDIDATE_DRAFTS; attempt++) {
      var drafted = Draft.draft(catalog, count, random);
      var spread = spread(request, drafted);
      if (spread < bestSpread) {
        bestSpread = spread;
        best = drafted;
      }
    }
    var shift =
        request.humanRatings().isEmpty()
            ? 0
            : MatchShift.choose(
                request.humanRatings(),
                best.stream().map(Personality::skill).toList(),
                MatchShift.TARGET_HUMAN_WIN);
    var bots = new ArrayList<Drafted>();
    for (var personality : best) {
      bots.add(
          new Drafted(
              personality,
              kit(personality, request.availableKits(), random),
              LeverCurves.effective(personality.skill(), personality.leverOffsets(), shift),
              request.ratingOf(personality)));
    }
    return new Pick(bots, shift);
  }

  /** How far apart the best team split of humans plus {@code drafted} would be. */
  private static double spread(Request request, List<Personality> drafted) {
    var lobby = new ArrayList<Participant>();
    for (var i = 0; i < request.humanRatings().size(); i++) {
      lobby.add(new Participant("human-" + i, request.humanRatings().get(i), true));
    }
    for (var personality : drafted) {
      lobby.add(new Participant(personality.id(), request.ratingOf(personality), false));
    }
    if (lobby.size() < request.teamCount()) {
      return 0;
    }
    return TeamBalancer.spread(TeamBalancer.balance(lobby, request.teamCount()));
  }

  /** A kit drawn from the personality's weights over the kits on offer. */
  static Kit kit(Personality personality, Set<Kit> available, RandomGenerator random) {
    var total = 0.0;
    for (var entry : personality.kits().entrySet()) {
      if (available.contains(entry.getKey())) {
        total += entry.getValue();
      }
    }
    var draw = random.nextDouble() * total;
    Kit last = null;
    for (var kit : Kit.values()) {
      var weight = personality.kits().get(kit);
      if (weight == null || !available.contains(kit)) {
        continue;
      }
      last = kit;
      draw -= weight;
      if (draw < 0) {
        return kit;
      }
    }
    if (last == null) {
      throw new IllegalArgumentException(personality.id() + " has no available kit");
    }
    return last;
  }
}
