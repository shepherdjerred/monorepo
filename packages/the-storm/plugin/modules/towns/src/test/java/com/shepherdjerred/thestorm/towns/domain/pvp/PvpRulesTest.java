package com.shepherdjerred.thestorm.towns.domain.pvp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The personal PvP switch: on by default, a free first change, then one change per cooldown. */
final class PvpRulesTest {

  private static final Instant NOW = Instant.parse("2026-09-25T12:00:00Z");
  private static final Duration WEEK = Duration.ofDays(7);
  private static final PvpRules.Timing PEACE = new PvpRules.Timing(WEEK, Optional.empty());

  @Test
  void everyoneStartsOn() {
    assertThat(PvpRules.isOn(Optional.empty())).isTrue();
    assertThat(PvpRules.isOn(Optional.of(new PvpSetting(false, NOW)))).isFalse();
    assertThat(PvpRules.nextChange(Optional.empty(), NOW, WEEK)).isEmpty();
  }

  @Test
  void theFirstChangeIsFree() {
    assertThat(PvpRules.change(Optional.empty(), false, NOW, PEACE))
        .isEqualTo(Result.ok(new PvpSetting(false, NOW)));
  }

  @Test
  void laterChangesWaitForTheCooldown() {
    var off = Optional.of(new PvpSetting(false, NOW));

    assertThat(PvpRules.change(off, true, NOW.plus(Duration.ofDays(6)), PEACE))
        .isEqualTo(Result.err(new PvpProblem.TooSoon(NOW.plus(WEEK))));
    assertThat(PvpRules.change(off, true, NOW.plus(WEEK).minusMillis(1), PEACE).isOk()).isFalse();
    assertThat(PvpRules.change(off, true, NOW.plus(WEEK), PEACE))
        .isEqualTo(Result.ok(new PvpSetting(true, NOW.plus(WEEK))));
    assertThat(PvpRules.nextChange(off, NOW.plus(WEEK), WEEK)).isEmpty();
    assertThat(PvpRules.nextChange(off, NOW, WEEK)).contains(NOW.plus(WEEK));
  }

  @Test
  void askingForWhatIsAlreadySetIsRefusedFirst() {
    var justOff = Optional.of(new PvpSetting(false, NOW));

    assertThat(PvpRules.change(justOff, false, NOW, PEACE))
        .isEqualTo(Result.err(new PvpProblem.AlreadySet(false)));
    assertThat(PvpRules.change(Optional.empty(), true, NOW, PEACE))
        .isEqualTo(Result.err(new PvpProblem.AlreadySet(true)));
  }

  @Test
  void aZeroCooldownLetsPlayersChangeAtWill() {
    var off = Optional.of(new PvpSetting(false, NOW));

    assertThat(
            PvpRules.change(off, true, NOW, new PvpRules.Timing(Duration.ZERO, Optional.empty()))
                .isOk())
        .isTrue();
  }

  @Test
  void combatLockBlocksEvenTheFirstChangeUntilItsDeadline() {
    var until = NOW.plusSeconds(30);
    var fighting = new PvpRules.Timing(WEEK, Optional.of(until));

    assertThat(PvpRules.change(Optional.empty(), false, NOW, fighting))
        .isEqualTo(Result.err(new PvpProblem.InFight(until)));
    assertThat(PvpRules.change(Optional.empty(), false, until, fighting))
        .isEqualTo(Result.ok(new PvpSetting(false, until)));
  }

  @Test
  void theCooldownIsNeverNegative() {
    assertThatThrownBy(() -> new PvpPolicy(-1, 30)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new PvpPolicy(168, -1)).isInstanceOf(IllegalArgumentException.class);
    assertThat(new PvpPolicy(168, 30).cooldown()).isEqualTo(WEEK);
  }
}
