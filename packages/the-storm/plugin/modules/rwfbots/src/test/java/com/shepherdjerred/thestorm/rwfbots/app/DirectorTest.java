package com.shepherdjerred.thestorm.rwfbots.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.director.Rating;
import com.shepherdjerred.thestorm.rwfbots.domain.director.SkillScale;
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
    return new Director.Request(catalog(), Map.of(), humans, slots, excluded, SHIPPED, 2);
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
        new Director.Request(catalog(), stored, List.of(Rating.DEFAULT), 5, Set.of(), SHIPPED, 2);

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

    assertThat(Director.kit(mixed, SHIPPED, new SplittableRandom(1))).isEqualTo(Kit.LONGBOW);
    assertThat(Director.kit(personality, Set.of(Kit.GHOST), new SplittableRandom(1)))
        .isEqualTo(Kit.GHOST);
  }

  @Test
  void aPersonalityWhoseFavouritesAreNotOnOfferPlaysAnyKitThatIs() {
    var random = new SplittableRandom(4);
    var played = EnumSet.noneOf(Kit.class);
    for (var draw = 0; draw < 200; draw++) {
      played.add(Director.kit(ghostOnly(), SHIPPED, random));
    }

    assertThat(played).containsExactlyInAnyOrderElementsOf(SHIPPED);
  }
}
