package com.shepherdjerred.thestorm.rwf.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.OptionalInt;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class LobbySessionTest {
  private static final UUID ALICE = new UUID(0, 1);
  private static final UUID BOB = new UUID(0, 2);
  private static final UUID CHARLIE = new UUID(0, 3);

  @Test
  void firstHumanHostsAndOwnershipTransfersInAdmissionOrder() {
    var session = new LobbySession();
    session.sync(List.of(ALICE));
    session.sync(List.of(ALICE, BOB, CHARLIE));
    assertThat(session.host()).contains(ALICE);
    var selected = BotSettings.DEFAULT.withCount(OptionalInt.of(12));
    assertThat(session.select(BOB, selected)).isFalse();
    assertThat(session.select(ALICE, selected)).isTrue();
    session.sync(List.of(BOB, CHARLIE));
    assertThat(session.host()).contains(BOB);
    assertThat(session.selected()).isEqualTo(selected);
    assertThat(session.select(ALICE, BotSettings.DEFAULT)).isFalse();
  }

  @Test
  void lockedRoundKeepsItsDraftAndChangesCarryIntoTheNextOne() {
    var session = new LobbySession();
    session.sync(List.of(ALICE));
    var first = new BotSettings(OptionalInt.of(4), BotDifficulty.EASY);
    assertThat(session.select(ALICE, first)).isTrue();
    session.lock();
    var next = new BotSettings(OptionalInt.of(0), BotDifficulty.HARD);
    assertThat(session.select(ALICE, next)).isTrue();
    session.lock();
    assertThat(session.current()).isEqualTo(first);
    session.sync(List.of(ALICE, BOB));
    session.nextRound();
    assertThat(session.current()).isEqualTo(next);
    assertThat(session.host()).contains(ALICE);
  }

  @Test
  void emptyHumanSessionResetsSettingsAndHost() {
    var session = new LobbySession();
    session.sync(List.of(ALICE));
    assertThat(session.select(ALICE, new BotSettings(OptionalInt.of(8), BotDifficulty.HARD)))
        .isTrue();
    session.lock();
    session.sync(List.of());
    assertThat(session.host()).isEmpty();
    assertThat(session.locked()).isFalse();
    assertThat(session.selected()).isEqualTo(BotSettings.DEFAULT);
    session.sync(List.of(BOB));
    assertThat(session.host()).contains(BOB);
  }

  @Test
  void zeroMeansOffAndFixedCountsExcludeHumansWithoutExceedingCapacity() {
    assertThat(BotSettings.DEFAULT.botsFor(24, 3, 100)).isEqualTo(21);
    assertThat(new BotSettings(OptionalInt.of(0), BotDifficulty.NORMAL).botsFor(24, 3, 100))
        .isZero();
    assertThat(new BotSettings(OptionalInt.of(8), BotDifficulty.NORMAL).botsFor(24, 3, 100))
        .isEqualTo(8);
    assertThat(new BotSettings(OptionalInt.of(100), BotDifficulty.NORMAL).botsFor(24, 3, 100))
        .isEqualTo(97);
    assertThatThrownBy(() -> new BotSettings(OptionalInt.of(-1), BotDifficulty.NORMAL))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void difficultyBandsKeepWeakAndStrongPersonalitiesDistinct() {
    assertThat(BotDifficulty.EASY.skill(0)).isEqualTo(0.15);
    assertThat(BotDifficulty.EASY.skill(1)).isEqualTo(0.40);
    assertThat(BotDifficulty.NORMAL.skill(0)).isEqualTo(0.35);
    assertThat(BotDifficulty.NORMAL.skill(1)).isEqualTo(0.65);
    assertThat(BotDifficulty.HARD.skill(0)).isEqualTo(0.60);
    assertThat(BotDifficulty.HARD.skill(1)).isEqualTo(0.85);
    for (var difficulty : BotDifficulty.values()) {
      assertThat(difficulty.skill(0.2)).isLessThan(difficulty.skill(0.8));
    }
    assertThatThrownBy(() -> BotDifficulty.NORMAL.skill(Double.NaN))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
