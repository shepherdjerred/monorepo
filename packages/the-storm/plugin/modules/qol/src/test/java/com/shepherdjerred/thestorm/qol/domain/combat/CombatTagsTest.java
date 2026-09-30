package com.shepherdjerred.thestorm.qol.domain.combat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class CombatTagsTest {

  static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");
  static final UUID CAROL = UUID.fromString("00000000-0000-0000-0000-00000000000c");
  static final Instant T0 = Instant.parse("2026-09-25T12:00:00Z");
  static final Duration TAG = Duration.ofSeconds(15);
  static final Duration NANO = Duration.ofNanos(1);

  @Test
  void aHitTagsBothPlayersForTheTagLength() {
    var tags = CombatTags.none().hit(ALICE, BOB, T0, TAG);

    assertThat(tags.remaining(ALICE, T0)).contains(TAG);
    assertThat(tags.remaining(BOB, T0)).contains(TAG);
    assertThat(tags.isTagged(CAROL, T0)).isFalse();
  }

  @Test
  void aTagEndsAtItsInstantExactly() {
    var tags = CombatTags.none().hit(ALICE, BOB, T0, TAG);

    assertThat(tags.remaining(ALICE, T0.plus(TAG).minus(NANO))).contains(NANO);
    assertThat(tags.remaining(ALICE, T0.plus(TAG))).isEmpty();
    assertThat(tags.isTagged(ALICE, T0.plus(TAG))).isFalse();
  }

  @Test
  void anotherHitRestartsTheClock() {
    var tags = CombatTags.none().hit(ALICE, BOB, T0, TAG).hit(BOB, ALICE, T0.plusSeconds(10), TAG);

    assertThat(tags.remaining(ALICE, T0.plusSeconds(20))).contains(Duration.ofSeconds(5));
    assertThat(tags.remaining(BOB, T0.plusSeconds(20))).contains(Duration.ofSeconds(5));
  }

  @Test
  void aShorterLaterTagNeverCutsALongerOne() {
    var tags =
        CombatTags.none()
            .hit(ALICE, BOB, T0, Duration.ofSeconds(60))
            .hit(ALICE, CAROL, T0.plusSeconds(1), TAG);

    assertThat(tags.remaining(ALICE, T0.plusSeconds(30))).contains(Duration.ofSeconds(30));
    assertThat(tags.remaining(CAROL, T0.plusSeconds(1))).contains(TAG);
  }

  @Test
  void hurtingYourselfTagsNobody() {
    assertThat(CombatTags.none().hit(ALICE, ALICE, T0, TAG).until()).isEmpty();
  }

  @Test
  void dyingClearsOnlyThatPlayersTag() {
    var tags = CombatTags.none().hit(ALICE, BOB, T0, TAG).clear(ALICE);

    assertThat(tags.isTagged(ALICE, T0)).isFalse();
    assertThat(tags.isTagged(BOB, T0)).isTrue();
    assertThat(tags.clear(CAROL)).isSameAs(tags);
  }

  @Test
  void sweepingDropsEndedTagsAndNamesTheirPlayers() {
    var tags = CombatTags.none().hit(BOB, ALICE, T0, TAG).hit(CAROL, BOB, T0.plusSeconds(10), TAG);

    var early = tags.sweep(T0.plus(TAG).minus(NANO));
    assertThat(early.ended()).isEmpty();
    assertThat(early.tags()).isEqualTo(tags);

    var swept = tags.sweep(T0.plus(TAG));
    assertThat(swept.ended()).containsExactly(ALICE);
    assertThat(swept.tags().isTagged(BOB, T0.plus(TAG))).isTrue();
    assertThat(swept.tags().until()).doesNotContainKey(ALICE);

    assertThat(tags.sweep(T0.plusSeconds(25)).ended()).containsExactly(ALICE, BOB, CAROL);
  }

  @Test
  void tagsMustLastAWhile() {
    assertThatThrownBy(() -> CombatTags.none().hit(ALICE, BOB, T0, Duration.ZERO))
        .hasMessageContaining("positive");
  }
}
