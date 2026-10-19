package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwf.app.BotDifficulty;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Lever;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverOffsets;
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
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.random.RandomGenerator;

/**
 * Drafts personalities whose balanced teams are closest and draws kits from their preferences over
 * the offered pool. The frozen-experience overload gives ordinary matches their configured
 * competence; the original overload retains the historical human-relative diagnostic draft. Pure:
 * the same request, experience and random source always pick the same bots.
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
   * @param excludedNames in-game names reserved by online humans or drafted bots, any case
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
      int teamCount,
      double rangedShare) {

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
      if (!(rangedShare >= 0 && rangedShare < 1)) {
        throw new IllegalArgumentException("ranged share must be in [0, 1): " + rangedShare);
      }
    }

    /**
     * The personalities that may be drafted: active and not a reserved name. Kit preferences never
     * exclude anyone; a personality whose favourites are not on offer plays one that is.
     */
    public List<Personality> pool() {
      return catalog.active().stream()
          .filter(p -> !excludedNames.contains(p.name().toLowerCase(Locale.ROOT)))
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
  public record Drafted(
      Personality personality,
      Kit kit,
      Levers levers,
      Rating rating,
      com.shepherdjerred.thestorm.rwfbots.domain.personality.Style style) {
    public Drafted(Personality personality, Kit kit, Levers levers, Rating rating) {
      this(personality, kit, levers, rating, personality.style());
    }
  }

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
    List<Personality> best = List.of();
    var bestSpread = Double.POSITIVE_INFINITY;
    for (var attempt = 0; attempt < CANDIDATE_DRAFTS; attempt++) {
      var drafted = Draft.draft(request.catalog(), request.excludedNames(), count, random);
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
    var boost = rangedBoost(best, request.availableKits(), request.rangedShare());
    var bots = new ArrayList<Drafted>();
    for (var personality : best) {
      bots.add(
          new Drafted(
              personality,
              kit(personality, request.availableKits(), boost, random),
              LeverCurves.effective(personality.skill(), offsets(personality), shift),
              request.ratingOf(personality)));
    }
    return new Pick(bots, shift);
  }

  /** A fixed difficulty draft. Human results never weaken an already selected difficulty. */
  public static Pick pick(
      Request request,
      com.shepherdjerred.thestorm.rwf.app.MatchExperiences.Frozen experience,
      RandomGenerator random) {
    // Reuse the proven balanced personality/kit draft, but do not use its human-win skill shift.
    var picked = pick(request, random);
    return new Pick(
        picked.bots().stream()
            .map(
                bot ->
                    new Drafted(
                        bot.personality(),
                        bot.kit(),
                        MatchCompetence.levers(
                            bot.personality(), experience.settings(), experience.seed()),
                        bot.rating(),
                        MatchCompetence.style(bot.personality(), experience.settings())))
            .toList(),
        0);
  }

  /** The personality's lever offsets with its archetype's push on aggression added. */
  static LeverOffsets offsets(Personality personality) {
    return personality.leverOffsets().plus(Lever.AGGRESSION, personality.archetype().aggressionZ());
  }

  /**
   * Explicit lobby difficulty replaces the adaptive skill shift, preserving personality offsets.
   */
  public static Pick inBand(Pick pick, BotDifficulty difficulty) {
    var bots =
        pick.bots().stream()
            .map(
                bot ->
                    new Drafted(
                        bot.personality(),
                        bot.kit(),
                        LeverCurves.at(
                            difficulty.skill(bot.personality().skill()),
                            offsets(bot.personality())),
                        bot.rating(),
                        bot.style()))
            .toList();
    return new Pick(bots, 0);
  }

  /** Host bands replace mechanical competence while retaining the frozen match's seeded variety. */
  public static Pick inBand(
      Pick pick,
      BotDifficulty difficulty,
      com.shepherdjerred.thestorm.rwf.app.MatchExperiences.Frozen experience) {
    return new Pick(
        pick.bots().stream().map(bot -> banded(bot, difficulty, experience)).toList(), 0);
  }

  private static Drafted banded(
      Drafted bot,
      BotDifficulty difficulty,
      com.shepherdjerred.thestorm.rwf.app.MatchExperiences.Frozen experience) {
    var random =
        new java.util.SplittableRandom(experience.seed() ^ bot.personality().id().hashCode());
    var spread = experience.settings().variety().spread();
    var varied = Math.clamp(bot.personality().skill() + random.nextDouble(-spread, spread), 0, 1);
    return new Drafted(
        bot.personality(),
        bot.kit(),
        LeverCurves.at(difficulty.skill(varied), offsets(bot.personality())),
        bot.rating(),
        bot.style());
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

  /** The most a draft's bow kits are weighted up to reach its ranged share. */
  static final double MAX_RANGED_BOOST = 16;

  /**
   * How much to weight bow and crossbow kits so the drafted personalities are expected to field at
   * least {@code share} ranged bots over the kits on offer: 1 when they already do, else the
   * smallest boost (to within 1%) that gets there, at most {@link #MAX_RANGED_BOOST}.
   */
  static double rangedBoost(List<Personality> drafted, Set<Kit> available, double share) {
    if (drafted.isEmpty() || rangedShare(drafted, available, 1) >= share) return 1;
    var low = 1.0;
    var high = MAX_RANGED_BOOST;
    if (rangedShare(drafted, available, high) < share) return high;
    while (high - low > 0.01) {
      var middle = (low + high) / 2;
      if (rangedShare(drafted, available, middle) >= share) high = middle;
      else low = middle;
    }
    return high;
  }

  /** The expected share of {@code drafted} that draw a bow kit with bow weights times boost. */
  static double rangedShare(List<Personality> drafted, Set<Kit> available, double boost) {
    var sum = 0.0;
    for (var personality : drafted) {
      var weights = weights(personality, available, boost);
      var total = 0.0;
      var ranged = 0.0;
      for (var entry : weights.entrySet()) {
        total += entry.getValue();
        if (entry.getKey().hasBow()) ranged += entry.getValue();
      }
      sum += ranged / total;
    }
    return sum / drafted.size();
  }

  /**
   * The personality's weights over the kits on offer, bow kits times {@code boost}; every kit on
   * offer weighs one when it weights none of them (its favourites ship in a later milestone).
   */
  private static Map<Kit, Double> weights(
      Personality personality, Set<Kit> available, double boost) {
    var weights = new java.util.EnumMap<Kit, Double>(Kit.class);
    for (var kit : Kit.values()) {
      var weight = personality.kits().get(kit);
      if (weight != null && weight > 0 && available.contains(kit)) weights.put(kit, weight);
    }
    if (weights.isEmpty()) {
      for (var kit : Kit.values()) if (available.contains(kit)) weights.put(kit, 1.0);
    }
    weights.replaceAll((kit, weight) -> kit.hasBow() ? weight * boost : weight);
    return weights;
  }

  /**
   * A kit drawn from the personality's weights over the kits on offer, or uniformly from the kits
   * on offer when it weights none of them, with bow kits weighted by {@code rangedBoost}.
   */
  static Kit kit(
      Personality personality, Set<Kit> available, double rangedBoost, RandomGenerator random) {
    var favourite =
        personality.kits().entrySet().stream()
            .anyMatch(entry -> entry.getValue() > 0 && available.contains(entry.getKey()));
    if (!favourite && rangedBoost == 1) {
      var offered = Arrays.stream(Kit.values()).filter(available::contains).toList();
      return offered.get(random.nextInt(offered.size()));
    }
    var weights = weights(personality, available, rangedBoost);
    var total = weights.values().stream().mapToDouble(Double::doubleValue).sum();
    var draw = random.nextDouble() * total;
    Kit last = null;
    for (var entry : weights.entrySet()) {
      last = entry.getKey();
      draw -= entry.getValue();
      if (draw < 0) return entry.getKey();
    }
    if (last == null) {
      throw new IllegalArgumentException(personality.id() + " has no available kit");
    }
    return last;
  }
}
