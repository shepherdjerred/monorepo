package com.shepherdjerred.thestorm.spells.domain.temporary;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.spells.domain.geometry.BlockPos;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

final class TemporaryBlocksTest {

  private static final Instant NOW = Instant.parse("2026-09-25T12:00:00Z");
  private static final String AIR = "minecraft:air";
  private static final String BRICKS = "minecraft:deepslate_bricks";
  private static final String WATER = "minecraft:water[level=0]";
  private static final String ICE = "minecraft:packed_ice";

  private static TemporaryBlock block(int x, String original, String placed, int seconds) {
    return new TemporaryBlock(
        new BlockKey("minecraft:overworld", x, 64, 0), original, placed, NOW.plusSeconds(seconds));
  }

  @Test
  void reservedBlocksAreNotDueUntilPlaced() {
    var ledger = new TemporaryBlockLedger();
    var wall = block(0, AIR, BRICKS, 10);

    assertThat(ledger.reserve(List.of(wall))).containsExactly(wall);
    assertThat(ledger.state(wall.key())).contains(TemporaryBlockLedger.State.RESERVED);
    assertThat(ledger.due(NOW.plusSeconds(60))).isEmpty();
    assertThat(ledger.placed()).isEmpty();

    ledger.placed(wall.key());
    assertThat(ledger.due(NOW.plusSeconds(9))).isEmpty();
    assertThat(ledger.due(NOW.plusSeconds(10))).containsExactly(wall);
    assertThat(ledger.placed()).containsExactly(wall);
  }

  @Test
  void aPositionHoldsOneTemporaryBlockSoNoneBecomesPermanent() {
    var ledger = new TemporaryBlockLedger();
    var wall = block(0, AIR, BRICKS, 10);
    // A second spell over the wall would record the bricks as its "original".
    var overlap = block(0, BRICKS, ICE, 20);
    var beside = block(1, AIR, BRICKS, 20);

    ledger.reserve(List.of(wall));
    assertThat(ledger.reserve(List.of(overlap, beside))).containsExactly(beside);
    assertThat(ledger.holds(wall.key())).isTrue();
    assertThat(ledger.size()).isEqualTo(2);
  }

  @Test
  void releasingFreesThePosition() {
    var ledger = new TemporaryBlockLedger();
    var wall = block(0, AIR, BRICKS, 10);
    ledger.reserve(List.of(wall));
    ledger.release(wall.key());

    assertThat(ledger.holds(wall.key())).isFalse();
    assertThat(ledger.state(wall.key())).isEmpty();
    assertThat(ledger.reserve(List.of(wall))).containsExactly(wall);
  }

  @Test
  void dueBlocksComeEarliestFirst() {
    var ledger = new TemporaryBlockLedger();
    var late = block(0, AIR, BRICKS, 30);
    var early = block(1, AIR, BRICKS, 5);
    ledger.restore(List.of(late, early));

    assertThat(ledger.due(NOW.plusSeconds(60))).containsExactly(early, late);
  }

  @Test
  void restoredBlocksAreAlreadyInTheWorld() {
    var ledger = new TemporaryBlockLedger();
    var left = block(0, WATER, ICE, -5);
    ledger.restore(List.of(left));

    assertThat(ledger.state(left.key())).contains(TemporaryBlockLedger.State.PLACED);
    assertThat(ledger.due(NOW)).containsExactly(left);
  }

  @Test
  void placingAnUnreservedBlockIsABug() {
    var ledger = new TemporaryBlockLedger();

    assertThatThrownBy(() -> ledger.placed(block(0, AIR, BRICKS, 1).key()))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void theRevertRestoresOurBlockOrAHoleAndNeverAnotherPlayersBlock() {
    var wall = block(0, AIR, BRICKS, 0);
    var ice = block(0, WATER, ICE, 0);

    assertThat(RevertRule.decide(wall, BRICKS, false)).isEqualTo(RevertRule.Action.RESTORE);
    assertThat(RevertRule.decide(ice, AIR, true)).isEqualTo(RevertRule.Action.RESTORE);
    assertThat(RevertRule.decide(wall, "minecraft:chest[facing=north]", false))
        .isEqualTo(RevertRule.Action.LEAVE);
  }

  @Test
  void aRevertAfterACrashIsHarmlessWhenTheOriginalIsBack() {
    // The server died after restoring but before forgetting the record, or before the block was
    // ever saved to disk: the world already shows the original.
    assertThat(RevertRule.decide(block(0, AIR, BRICKS, 0), AIR, true))
        .isEqualTo(RevertRule.Action.LEAVE);
    assertThat(RevertRule.decide(block(0, WATER, ICE, 0), WATER, false))
        .isEqualTo(RevertRule.Action.LEAVE);
  }

  @Test
  void aTemporaryBlockMustChangeSomething() {
    assertThatThrownBy(() -> block(0, AIR, AIR, 1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> block(0, " ", AIR, 1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new BlockKey(" ", 0, 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void blockKeysRoundTripPositions() {
    var pos = new BlockPos(1, -2, 3);

    assertThat(BlockKey.of("minecraft:the_nether", pos).pos()).isEqualTo(pos);
  }

  @ParameterizedTest
  @EnumSource(Replaceability.Mode.class)
  void blockEntitiesAndMultiBlocksAreNeverReplaced(Replaceability.Mode mode) {
    for (var kind : BlockFacts.Kind.values()) {
      assertThat(Replaceability.canReplace(new BlockFacts(kind, true, false), mode)).isFalse();
      assertThat(Replaceability.canReplace(new BlockFacts(kind, false, true), mode)).isFalse();
    }
  }

  @Test
  void openSpaceMeansAirOrSoftPlants() {
    var mode = Replaceability.Mode.OPEN_SPACE;

    assertThat(Replaceability.canReplace(BlockFacts.air(), mode)).isTrue();
    assertThat(Replaceability.canReplace(new BlockFacts(BlockFacts.Kind.SOFT, false, false), mode))
        .isTrue();
    assertThat(
            Replaceability.canReplace(
                new BlockFacts(BlockFacts.Kind.WATER_SOURCE, false, false), mode))
        .isFalse();
    assertThat(Replaceability.canReplace(new BlockFacts(BlockFacts.Kind.OTHER, false, false), mode))
        .isFalse();
  }

  @Test
  void freezeReplacesStillWaterOnly() {
    var mode = Replaceability.Mode.WATER;

    assertThat(
            Replaceability.canReplace(
                new BlockFacts(BlockFacts.Kind.WATER_SOURCE, false, false), mode))
        .isTrue();
    assertThat(Replaceability.canReplace(BlockFacts.air(), mode)).isFalse();
    assertThat(Replaceability.canReplace(new BlockFacts(BlockFacts.Kind.SOFT, false, false), mode))
        .isFalse();
  }
}
