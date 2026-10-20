package com.shepherdjerred.thestorm.creative.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.snapshot.Experience;
import com.shepherdjerred.thestorm.core.snapshot.ItemData;
import com.shepherdjerred.thestorm.core.snapshot.Position;
import com.shepherdjerred.thestorm.core.snapshot.Snapshot;
import com.shepherdjerred.thestorm.core.snapshot.Vitals;
import com.shepherdjerred.thestorm.creative.domain.BodyRole;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class BodySwapTest {

  private static final UUID PLAYER = UUID.fromString("00000000-0000-0000-0000-000000000004");

  @Test
  void loginResumesInsideAndRestoresOutside() {
    assertThat(BodySwap.onJoin(true, true)).isEqualTo(BodySwap.Arrival.RESUME);
    assertThat(BodySwap.onJoin(false, true)).isEqualTo(BodySwap.Arrival.RESTORE);
    assertThat(BodySwap.onJoin(true, false)).isEqualTo(BodySwap.Arrival.NONE);
    assertThat(BodySwap.onJoin(false, false)).isEqualTo(BodySwap.Arrival.NONE);
  }

  @Test
  void enterRefusesArenaSealedWorldsAndASecondVisit() {
    assertThat(BodySwap.enter(new BodySwap.Attempt(false, false, false, false, false)))
        .isEqualTo(BodySwap.Verdict.OPEN_AT_SPAWN);
    assertThat(BodySwap.enter(new BodySwap.Attempt(true, false, false, false, false)))
        .isEqualTo(BodySwap.Verdict.OPEN_HERE);
    assertThat(BodySwap.enter(new BodySwap.Attempt(true, true, false, false, false)))
        .isEqualTo(BodySwap.Verdict.ALREADY);
    assertThat(BodySwap.enter(new BodySwap.Attempt(false, true, false, false, false)))
        .isEqualTo(BodySwap.Verdict.RESTORE_FIRST);
    assertThat(BodySwap.enter(new BodySwap.Attempt(false, false, true, false, false)))
        .isEqualTo(BodySwap.Verdict.BUSY);
    assertThat(BodySwap.enter(new BodySwap.Attempt(false, false, false, true, false)))
        .isEqualTo(BodySwap.Verdict.IN_ARENA);
    assertThat(BodySwap.enter(new BodySwap.Attempt(false, false, false, false, true)))
        .isEqualTo(BodySwap.Verdict.SEALED);
  }

  @Test
  void leaveReturnsSurvivalAndDropsCreativeProgress() {
    var survival = body(BodyRole.SURVIVAL, 12, new byte[] {1}, new byte[] {9});
    var creative = body(BodyRole.CREATIVE, 40, new byte[] {2}, new byte[] {8});

    var back = BodySwap.restored(survival, creative);

    assertThat(back).isEqualTo(survival);
    assertThat(back.snapshot().experience().total()).isEqualTo(12);
    assertThat(back.enderChest()).isEqualTo(ItemData.of(new byte[] {9}));
    assertThat(back.snapshot().inventory()).isEqualTo(ItemData.of(new byte[] {1}));
  }

  @Test
  void leaveRejectsACreativeBodyInTheSurvivalSlot() {
    var creative = body(BodyRole.CREATIVE, 1, new byte[] {1}, new byte[] {1});
    var survival = body(BodyRole.SURVIVAL, 1, new byte[] {1}, new byte[] {1});

    assertThatThrownBy(() -> BodySwap.restored(creative, survival))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void theBookHoldsOnlyTheSurvivalBody() {
    var survival = body(BodyRole.SURVIVAL, 3, new byte[] {4}, new byte[] {5});
    var book = VisitBook.EMPTY.hold(survival);

    assertThat(book.inside(PLAYER)).isTrue();
    assertThat(book.survival(PLAYER)).contains(survival);
    assertThat(book.drop(PLAYER).inside(PLAYER)).isFalse();
    assertThatThrownBy(
            () -> VisitBook.EMPTY.hold(body(BodyRole.CREATIVE, 0, new byte[0], new byte[0])))
        .isInstanceOf(IllegalArgumentException.class);
  }

  private static VisitBody body(
      BodyRole role, int experience, byte[] inventory, byte[] enderChest) {
    return new VisitBody(
        role,
        new Snapshot(
            PLAYER,
            role.wire(),
            new Position(role == BodyRole.CREATIVE ? "creative" : "world", 1, 64, 2, 10, 0),
            new Vitals(
                new Vitals.Condition(20, 20, 5, 0.25f),
                role == BodyRole.CREATIVE ? "CREATIVE" : "SURVIVAL",
                new Vitals.Flight(role == BodyRole.CREATIVE, false, 0.1f),
                20),
            new Experience(experience, 0, experience),
            ItemData.of(inventory),
            List.of(),
            Instant.EPOCH),
        ItemData.of(enderChest));
  }
}
