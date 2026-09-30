package com.shepherdjerred.thestorm.spells.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.spells.domain.geometry.Vec3;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class SpellStateTest {

  private static final Instant NOW = Instant.parse("2026-09-25T12:00:00Z");
  private static final UUID ALICE = new UUID(0, 1);
  private static final UUID BOB = new UUID(0, 2);
  private static final String WORLD = "minecraft:overworld";

  @Test
  void everySpellHasALowercaseSingleWordId() {
    for (var kind : SpellKind.values()) {
      assertThat(kind.id()).matches("[a-z]+");
      assertThat(SpellKind.byId(kind.id())).contains(kind);
    }
    assertThat(SpellKind.byId("fire_nova")).isEmpty();
    assertThat(SpellKind.values()).hasSize(32);
  }

  @Test
  void eachBindInvalidatesEveryEarlierFocus() {
    var foci = new Foci();
    var key = new FocusKey(ALICE, SpellKind.WALL);

    var first = foci.bind(key);
    var second = foci.bind(key);

    assertThat(first).isEqualTo(1);
    assertThat(second).isEqualTo(2);
    assertThat(foci.isCurrent(key, second)).isTrue();
    assertThat(foci.isCurrent(key, first)).isFalse();
    assertThat(foci.isCurrent(new FocusKey(BOB, SpellKind.WALL), second)).isFalse();
    assertThat(foci.isCurrent(new FocusKey(ALICE, SpellKind.LEAP), second)).isFalse();
  }

  @Test
  void restoredBindsContinueTheirGeneration() {
    var foci = new Foci();
    var key = new FocusKey(ALICE, SpellKind.BLINK);
    foci.restore(Map.of(key, 7L));

    assertThat(foci.isCurrent(key, 7)).isTrue();
    assertThat(foci.bind(key)).isEqualTo(8);
  }

  @Test
  void wardsCoverTheirBubbleUntilTheyFade() {
    var wards = new Wards();
    var centre = new Vec3(0, 64, 0);
    wards.raise(new Wards.Ward(ALICE, WORLD, centre, 6, 0.5, NOW.plusSeconds(60)));

    assertThat(wards.covering(WORLD, new Vec3(3, 64, 4), NOW)).isPresent();
    assertThat(wards.covering(WORLD, new Vec3(6, 64, 4), NOW)).isEmpty();
    assertThat(wards.covering("minecraft:the_nether", centre, NOW)).isEmpty();
    assertThat(wards.covering(WORLD, centre, NOW.plusSeconds(60))).isEmpty();
    assertThat(wards.active(NOW.plusSeconds(60))).isEmpty();
  }

  @Test
  void castingWardAgainMovesIt() {
    var wards = new Wards();
    wards.raise(new Wards.Ward(ALICE, WORLD, new Vec3(0, 64, 0), 6, 0.5, NOW.plusSeconds(60)));
    wards.raise(new Wards.Ward(ALICE, WORLD, new Vec3(100, 64, 0), 6, 0.5, NOW.plusSeconds(60)));
    wards.raise(new Wards.Ward(BOB, WORLD, new Vec3(0, 64, 0), 6, 0.5, NOW.plusSeconds(60)));

    assertThat(wards.active(NOW)).hasSize(2);
    assertThat(wards.covering(WORLD, new Vec3(100, 64, 0), NOW).map(Wards.Ward::owner))
        .contains(ALICE);
    assertThat(wards.covering(WORLD, new Vec3(0, 64, 0), NOW).map(Wards.Ward::owner)).contains(BOB);
  }

  @Test
  void wardsNeedARadius() {
    assertThatThrownBy(() -> new Wards.Ward(ALICE, WORLD, Vec3.ZERO, 0, 0.5, NOW))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void screeningKeepsTheAllowedAndTheFirstDenial() {
    var screened =
        Screening.screen(
            List.of(1, 2, 3, 4),
            number -> number % 2 == 0 ? Optional.of("even " + number) : Optional.<String>empty());

    assertThat(screened.allowed()).containsExactly(1, 3);
    assertThat(screened.firstDenial()).contains("even 2");
    assertThat(screened.isEmpty()).isFalse();
  }

  @Test
  void screeningNothingIsEmptyWithoutADenial() {
    var screened = Screening.screen(List.<Integer>of(), number -> Optional.of("no"));

    assertThat(screened.isEmpty()).isTrue();
    assertThat(screened.firstDenial()).isEmpty();
  }

  @Test
  void refusalsReadNaturally() {
    assertThat(RefusalText.describe(new Refusal.TierTooLow(3, 1)))
        .isEqualTo("You need Spellcaster III (you are Spellcaster I).");
    assertThat(RefusalText.describe(new Refusal.TierTooLow(1, 0)))
        .isEqualTo("You need Spellcaster I (you are untrained).");
    assertThat(RefusalText.describe(new Refusal.OnCooldown(Duration.ofMillis(1_200))))
        .isEqualTo("Ready again in 2s.");
    assertThat(RefusalText.describe(new Refusal.Silenced(Duration.ofSeconds(125))))
        .isEqualTo("You are silenced for 2m 5s.");
    assertThat(
            RefusalText.describe(
                new Refusal.MissingReagents(Map.of("REDSTONE", 5, "LAPIS_LAZULI", 2))))
        .isEqualTo("You need 2 lapis lazuli, 5 redstone more.");
    assertThat(RefusalText.describe(new Refusal.NoTarget("creature in sight")))
        .isEqualTo("No creature in sight to target.");
    assertThat(RefusalText.seconds(Duration.ofMinutes(2))).isEqualTo("2m");
    assertThat(RefusalText.seconds(Duration.ZERO)).isEqualTo("1s");
  }

  @Test
  void everyRefusalHasWords() {
    List<Refusal> all =
        List.of(
            new Refusal.Disabled(),
            new Refusal.NotLearned(),
            new Refusal.NoSafeSpot(),
            new Refusal.NoMark(),
            new Refusal.NoWall(),
            new Refusal.Loading(),
            new Refusal.NotYourFocus(),
            new Refusal.StaleFocus(),
            new Refusal.InventoryFull());
    assertThat(all).allSatisfy(refusal -> assertThat(RefusalText.describe(refusal)).endsWith("."));
  }

  @Test
  void romanNumeralsCoverTheFiveTiers() {
    assertThat(List.of(1, 2, 3, 4, 5).stream().map(RefusalText::roman))
        .containsExactly("I", "II", "III", "IV", "V");
    assertThatThrownBy(() -> RefusalText.roman(6)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void waypointsNeedAWorldAndFiniteCoordinates() {
    assertThatThrownBy(() -> new Waypoint("", 0, 0, 0, 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Waypoint(WORLD, Double.NaN, 0, 0, 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
