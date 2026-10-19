package com.shepherdjerred.thestorm.rwfbots.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwf.app.BotDifficulty;
import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Lever;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverOffsets;
import com.shepherdjerred.thestorm.rwfbots.domain.director.Rating;
import com.shepherdjerred.thestorm.rwfbots.domain.director.SkillScale;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.PersonalityCatalog;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** The director drafts from the eligible pool, balances, shifts and hands out kits. */
final class DirectorTest {

  private static final Set<Kit> SHIPPED =
      Set.of(Kit.TROOPER, Kit.LONGBOW, Kit.SHORTBOW, Kit.REWIND);

  private static Personality ghostOnly() {
    return Fixtures.withWeights(
        Fixtures.personality("spectre", "Spectre", 0.5),
        Map.of(Kit.GHOST, 1.0),
        Map.of(Role.HUNT, 1.0));
  }

  private static PersonalityCatalog catalog() {
    return new PersonalityCatalog(
        List.of(
            Fixtures.personality("ash", "Ash_42", 0.2),
            Fixtures.personality("bramble", "Bramble", 0.4),
            Fixtures.personality("cinder", "Cinder", 0.6),
            Fixtures.personality("dusk", "DuskRunner", 0.8),
            Fixtures.personality("ember", "Ember_9", 0.95),
            ghostOnly()));
  }

  private static Director.Request request(int slots, List<Rating> humans, Set<String> excluded) {
    return new Director.Request(catalog(), Map.of(), humans, slots, excluded, SHIPPED, 2, 0);
  }

  @Test
  void explicitDifficultyKeepsIdentitiesKitsRatingsAndSkillVariation() {
    var drafted =
        Director.pick(request(6, List.of(Rating.DEFAULT), Set.of()), new SplittableRandom(11));
    var easy = Director.inBand(drafted, BotDifficulty.EASY);
    var hard = Director.inBand(drafted, BotDifficulty.HARD);
    assertThat(easy.bots())
        .extracting(bot -> bot.personality().id())
        .containsExactlyElementsOf(
            drafted.bots().stream().map(bot -> bot.personality().id()).toList());
    assertThat(hard.bots())
        .extracting(Director.Drafted::kit)
        .containsExactlyElementsOf(drafted.bots().stream().map(Director.Drafted::kit).toList());
    assertThat(hard.bots())
        .extracting(Director.Drafted::rating)
        .containsExactlyElementsOf(drafted.bots().stream().map(Director.Drafted::rating).toList());
    for (var i = 0; i < easy.bots().size(); i++) {
      assertThat(easy.bots().get(i).levers().aimErrorDeg())
          .isGreaterThan(hard.bots().get(i).levers().aimErrorDeg());
    }
    assertThat(easy.bots().stream().map(bot -> bot.levers().aimErrorDeg()).distinct())
        .hasSizeGreaterThan(1);
  }

  @Test
  void hostSkillBandsRetainFrozenMatchStyleAndSeededVariety() {
    var settings =
        com.shepherdjerred.thestorm.rwf.app.ExperienceSettings.DEFAULT
            .withStyle(com.shepherdjerred.thestorm.rwf.app.ExperienceSettings.Style.TEAMPLAY)
            .withVariety(com.shepherdjerred.thestorm.rwf.app.ExperienceSettings.Variety.HIGH);
    var frozen =
        new com.shepherdjerred.thestorm.rwf.app.MatchExperiences.Frozen(
            new java.util.UUID(0, 1), 7, settings);
    var drafted = Director.pick(request(6, List.of(), Set.of()), frozen, new SplittableRandom(11));
    var easy = Director.inBand(drafted, BotDifficulty.EASY, frozen);
    assertThat(easy.bots())
        .extracting(Director.Drafted::style)
        .containsExactlyElementsOf(drafted.bots().stream().map(Director.Drafted::style).toList());
    assertThat(easy.bots())
        .extracting(Director.Drafted::kit)
        .containsExactlyElementsOf(drafted.bots().stream().map(Director.Drafted::kit).toList());
    assertThat(Director.inBand(drafted, BotDifficulty.EASY, frozen)).isEqualTo(easy);
    var next =
        new com.shepherdjerred.thestorm.rwf.app.MatchExperiences.Frozen(
            frozen.matchId(), 8, settings);
    assertThat(Director.inBand(drafted, BotDifficulty.EASY, next).bots())
        .extracting(Director.Drafted::levers)
        .isNotEqualTo(easy.bots().stream().map(Director.Drafted::levers).toList());
  }

  @Test
  void thePoolExcludesOnlineHumansNamesButNotPersonalitiesWhoseKitsAreNotOnOffer() {
    var pool = request(4, List.of(), Set.of("ash_42")).pool();

    assertThat(pool)
        .extracting(Personality::id)
        .containsExactly("bramble", "cinder", "dusk", "ember", "spectre");
  }

  @Test
  void everyPersonalityCanBeDraftedAndPlaysAKitOnOffer() {
    var pick = Director.pick(request(6, List.of(), Set.of()), new SplittableRandom(1));

    assertThat(pick.bots())
        .extracting(d -> d.personality().id())
        .containsExactlyInAnyOrder("ash", "bramble", "cinder", "dusk", "ember", "spectre");
    assertThat(pick.bots()).extracting(Director.Drafted::kit).allMatch(SHIPPED::contains);
  }

  @Test
  void aShortPoolFillsFewerSlotsAndAnEmptyOneNone() {
    var pick = Director.pick(request(10, List.of(), Set.of()), new SplittableRandom(1));
    assertThat(pick.bots()).hasSize(6);
    assertThat(pick.bots()).extracting(d -> d.personality().id()).doesNotHaveDuplicates();

    var none =
        Director.pick(
            request(
                3,
                List.of(),
                Set.of("Ash_42", "BRAMBLE", "cinder", "DuskRunner", "Ember_9", "spectre")),
            new SplittableRandom(1));
    assertThat(none.bots()).isEmpty();
  }

  @Test
  void anExcludedRivalStaysValidInTheFullCatalogButCannotBeDrafted() {
    var base = Fixtures.personality("challenger", "Challenger", 0.6);
    var rival = Fixtures.personality("rival", "RivalPlayer", 0.4);
    var linked =
        new Personality(
            base.id(),
            base.name(),
            base.skinValue(),
            base.skinSignature(),
            base.skill(),
            base.archetype(),
            base.leverOffsets(),
            base.kits(),
            base.roles(),
            base.style(),
            base.voice(),
            base.lines(),
            base.quirks(),
            List.of(rival.id()),
            base.bio(),
            base.batch(),
            false);
    var request =
        new Director.Request(
            new PersonalityCatalog(List.of(linked, rival)),
            Map.of(),
            List.of(Rating.DEFAULT),
            2,
            Set.of("RIVALPLAYER"),
            SHIPPED,
            2,
            0);
    var pick = Director.pick(request, new SplittableRandom(8));
    assertThat(pick.bots()).extracting(b -> b.personality().id()).containsExactly("challenger");
  }

  @Test
  void withoutHumansThereIsNoShiftAndNewcomersPlayAtTheirSkillsRating() {
    var pick = Director.pick(request(2, List.of(), Set.of()), new SplittableRandom(3));

    assertThat(pick.shift()).isZero();
    for (var bot : pick.bots()) {
      assertThat(bot.rating().mu()).isEqualTo(SkillScale.toMu(bot.personality().skill()));
      assertThat(SHIPPED).contains(bot.kit());
    }
  }

  @Test
  void weakHumansPullEveryBotDownAndStrongHumansPushThemUp() {
    var weak =
        Director.pick(request(4, List.of(new Rating(12, 2)), Set.of()), new SplittableRandom(5));
    var strong =
        Director.pick(request(4, List.of(new Rating(38, 2)), Set.of()), new SplittableRandom(5));

    assertThat(weak.shift()).isNegative();
    assertThat(strong.shift()).isPositive();
    var weakest =
        weak.bots().stream().mapToDouble(b -> b.levers().aimErrorDeg()).max().orElseThrow();
    var strongest =
        strong.bots().stream().mapToDouble(b -> b.levers().aimErrorDeg()).min().orElseThrow();
    assertThat(weakest).isGreaterThan(strongest);
  }

  @Test
  void storedRatingsAreUsedWhenPresentAndTheDraftIsDeterministic() {
    var stored = Map.of("ember", new Rating(30, 3));
    var request =
        new Director.Request(
            catalog(), stored, List.of(Rating.DEFAULT), 5, Set.of(), SHIPPED, 2, 0);

    var a = Director.pick(request, new SplittableRandom(9));
    var b = Director.pick(request, new SplittableRandom(9));

    assertThat(a).isEqualTo(b);
    assertThat(
            a.bots().stream()
                .filter(d -> d.personality().id().equals("ember"))
                .findFirst()
                .orElseThrow()
                .rating())
        .isEqualTo(new Rating(30, 3));
  }

  @Test
  void kitsComeFromThePersonalitysWeightsOverTheKitsOnOffer() {
    var personality = ghostOnly();
    var mixed =
        Fixtures.withWeights(
            Fixtures.personality("mix", "Mixer", 0.5),
            Map.of(Kit.GHOST, 5.0, Kit.LONGBOW, 1.0),
            Map.of(Role.HUNT, 1.0));

    assertThat(Director.kit(mixed, SHIPPED, 1, new SplittableRandom(1))).isEqualTo(Kit.LONGBOW);
    assertThat(Director.kit(personality, Set.of(Kit.GHOST), 1, new SplittableRandom(1)))
        .isEqualTo(Kit.GHOST);
  }

  @Test
  void aPersonalityWhoseFavouritesAreNotOnOfferPlaysAnyKitThatIs() {
    var random = new SplittableRandom(4);
    var played = EnumSet.noneOf(Kit.class);
    for (var draw = 0; draw < 200; draw++) {
      played.add(Director.kit(ghostOnly(), SHIPPED, 1, random));
    }

    assertThat(played).containsExactlyInAnyOrderElementsOf(SHIPPED);
  }

  @Test
  void anArchetypePushesTheAggressionLeverWithoutReplacingSkill() {
    var base = Fixtures.personality("calm", "Calm", 0.5);
    var rusher = Fixtures.withArchetype(base, Archetype.RUSHER);
    var turtle = Fixtures.withArchetype(base, Archetype.TURTLE);
    assertThat(Director.offsets(rusher).z(Lever.AGGRESSION))
        .isEqualTo(Archetype.RUSHER.aggressionZ());
    assertThat(Director.offsets(turtle).z(Lever.AGGRESSION))
        .isEqualTo(Archetype.TURTLE.aggressionZ());
    var fast = LeverCurves.effective(0.5, Director.offsets(rusher), 0);
    var slow = LeverCurves.effective(0.5, Director.offsets(turtle), 0);
    assertThat(fast.aggression()).isGreaterThan(slow.aggression());
    assertThat(fast.aimErrorDeg()).isEqualTo(slow.aimErrorDeg());
  }

  @Test
  void leverOffsetsStayInsideTheirRange() {
    var pushed = LeverOffsets.NONE.plus(Lever.AGGRESSION, 2.5).plus(Lever.AGGRESSION, 2.5);
    assertThat(pushed.z(Lever.AGGRESSION)).isEqualTo(LeverOffsets.MAX_Z);
  }

  @Test
  void aDraftThatLeansMeleeHasItsBowKitsWeightedUpToTheRangedShare() {
    var troopers =
        List.of(
            Fixtures.withWeights(
                Fixtures.personality("anvil", "Anvil", 0.5),
                Map.of(Kit.TROOPER, 0.9, Kit.LONGBOW, 0.1),
                Map.of(Role.HUNT, 1.0)),
            Fixtures.withWeights(
                Fixtures.personality("brick", "Brick", 0.5),
                Map.of(Kit.TROOPER, 0.8, Kit.SHORTBOW, 0.2),
                Map.of(Role.HUNT, 1.0)));
    var offered = EnumSet.of(Kit.TROOPER, Kit.LONGBOW, Kit.SHORTBOW);
    assertThat(Director.rangedShare(troopers, offered, 1)).isCloseTo(0.15, within(1e-9));

    var boost = Director.rangedBoost(troopers, offered, 0.35);

    assertThat(boost).isGreaterThan(1);
    assertThat(Director.rangedShare(troopers, offered, boost)).isBetween(0.35, 0.36);
    var random = new SplittableRandom(5);
    var bows = 0;
    for (var draw = 0; draw < 20_000; draw++) {
      if (Director.kit(troopers.get(draw % 2), offered, boost, random).hasBow()) bows++;
    }
    assertThat(bows / 20_000.0).isCloseTo(0.35, within(0.02));
  }

  @Test
  void aDraftAlreadyAtItsRangedShareOrWithoutBowsOnOfferIsLeftAlone() {
    var archer =
        List.of(
            Fixtures.withWeights(
                Fixtures.personality("quill", "Quill", 0.5),
                Map.of(Kit.LONGBOW, 1.0),
                Map.of(Role.HUNT, 1.0)));
    assertThat(Director.rangedBoost(archer, EnumSet.of(Kit.LONGBOW, Kit.TROOPER), 0.35))
        .isEqualTo(1);
    assertThat(Director.rangedBoost(List.of(ghostOnly()), EnumSet.of(Kit.TROOPER), 0.35))
        .as("no bow on offer: the cap, which changes nothing")
        .isEqualTo(Director.MAX_RANGED_BOOST);
    assertThat(
            Director.kit(
                ghostOnly(),
                EnumSet.of(Kit.TROOPER),
                Director.MAX_RANGED_BOOST,
                new SplittableRandom(1)))
        .isEqualTo(Kit.TROOPER);
  }
}
