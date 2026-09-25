package com.shepherdjerred.thestorm.spells.domain.cast;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.spells.domain.Refusal;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class CastRulesTest {

  private static final ReagentCost COST =
      new ReagentCost(Map.of("REDSTONE", 10, "LAPIS_LAZULI", 5));
  private static final Map<String, Integer> ENOUGH = Map.of("REDSTONE", 64, "LAPIS_LAZULI", 64);

  private static SpellTerms terms(int tier, boolean learned) {
    return new SpellTerms(true, tier, learned, COST, "group", Duration.ofSeconds(30));
  }

  private static CasterState caster(int tier) {
    return new CasterState(tier, false, Duration.ZERO, Duration.ZERO, ENOUGH);
  }

  private static CastAttempt focus(SpellTerms terms, CasterState caster) {
    return new CastAttempt(CastMode.FOCUS, terms, caster);
  }

  @ParameterizedTest
  @CsvSource({"1,1", "1,5", "3,3", "3,4", "5,5"})
  void aFocusCastsAtOrAboveTheSpellsTier(int required, int held) {
    assertThat(CastRules.casting().check(focus(terms(required, false), caster(held)))).isEmpty();
  }

  @ParameterizedTest
  @CsvSource({"1,0", "2,1", "3,2", "5,4", "5,0"})
  void aFocusBelowTheSpellsTierIsRefusedWithBothLevels(int required, int held) {
    assertThat(CastRules.casting().first(focus(terms(required, false), caster(held))))
        .contains(new Refusal.TierTooLow(required, held));
  }

  @Test
  void aQuestOnlySpellNeedsLearningAsWellAsTheTier() {
    var unlearned = focus(terms(3, true), caster(5));
    var learned =
        focus(terms(3, true), new CasterState(5, true, Duration.ZERO, Duration.ZERO, ENOUGH));
    var learnedButLow =
        focus(terms(3, true), new CasterState(2, true, Duration.ZERO, Duration.ZERO, ENOUGH));

    assertThat(CastRules.casting().check(unlearned)).containsExactly(new Refusal.NotLearned());
    assertThat(CastRules.casting().check(learned)).isEmpty();
    assertThat(CastRules.casting().check(learnedButLow))
        .containsExactly(new Refusal.TierTooLow(3, 2));
  }

  @Test
  void aScrollIgnoresTierLearningAndReagents() {
    var untrained = new CasterState(0, false, Duration.ZERO, Duration.ZERO, Map.of());
    var scroll = new CastAttempt(CastMode.SCROLL, terms(5, true), untrained);

    assertThat(CastRules.casting().check(scroll)).isEmpty();
  }

  @Test
  void aScrollStillWaitsForSilenceAndCooldown() {
    var silenced =
        new CasterState(0, false, Duration.ofSeconds(4), Duration.ofSeconds(9), Map.of());
    var scroll = new CastAttempt(CastMode.SCROLL, terms(1, false), silenced);

    assertThat(CastRules.casting().check(scroll))
        .containsExactly(
            new Refusal.Silenced(Duration.ofSeconds(4)),
            new Refusal.OnCooldown(Duration.ofSeconds(9)));
  }

  @Test
  void missingReagentsAreReportedPerMaterial() {
    var poor = new CasterState(5, false, Duration.ZERO, Duration.ZERO, Map.of("REDSTONE", 3));

    assertThat(CastRules.casting().first(focus(terms(1, false), poor)))
        .contains(new Refusal.MissingReagents(Map.of("REDSTONE", 7, "LAPIS_LAZULI", 5)));
  }

  @Test
  void aDisabledSpellIsRefusedFirstAndForScrollsToo() {
    var off = new SpellTerms(false, 1, false, COST, "group", Duration.ofSeconds(1));
    var scroll = new CastAttempt(CastMode.SCROLL, off, caster(5));

    assertThat(CastRules.casting().first(focus(off, caster(0)))).contains(new Refusal.Disabled());
    assertThat(CastRules.casting().check(scroll)).containsExactly(new Refusal.Disabled());
  }

  @Test
  void everyRefusalIsCollectedInGateOrder() {
    var everything =
        new CasterState(0, false, Duration.ofSeconds(2), Duration.ofSeconds(3), Map.of());

    assertThat(CastRules.casting().check(focus(terms(2, true), everything)))
        .containsExactly(
            new Refusal.TierTooLow(2, 0),
            new Refusal.NotLearned(),
            new Refusal.Silenced(Duration.ofSeconds(2)),
            new Refusal.OnCooldown(Duration.ofSeconds(3)),
            new Refusal.MissingReagents(Map.of("REDSTONE", 10, "LAPIS_LAZULI", 5)));
  }

  @Test
  void bindingOnlyChecksAvailabilityAndKnowledge() {
    var busy = new CasterState(2, false, Duration.ofSeconds(2), Duration.ofSeconds(3), Map.of());

    assertThat(CastRules.binding().check(focus(terms(2, false), busy))).isEmpty();
    assertThat(CastRules.binding().check(focus(terms(3, false), busy)))
        .containsExactly(new Refusal.TierTooLow(3, 2));
  }
}
