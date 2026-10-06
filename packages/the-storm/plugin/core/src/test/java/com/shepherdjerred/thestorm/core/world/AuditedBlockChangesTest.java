package com.shepherdjerred.thestorm.core.world;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Material;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

final class AuditedBlockChangesTest {
  private final org.mockbukkit.mockbukkit.ServerMock server = MockBukkit.mock();
  private final org.bukkit.block.Block block = server.addSimpleWorld("world").getBlockAt(0, 64, 0);

  @AfterEach
  void close() {
    MockBukkit.unmock();
  }

  @Test
  void recordsTheOriginalAndReplacementBeforeChangingTheBlock() {
    block.setType(Material.STONE);
    var records = new ArrayList<AuditedBlockChanges.Change>();
    var changes =
        new AuditedBlockChanges(
            change -> {
              assertThat(block.getType()).isEqualTo(Material.STONE);
              records.add(change);
            });
    changes.set("#storm-spells", block, Material.PACKED_ICE.createBlockData(), false);
    assertThat(block.getType()).isEqualTo(Material.PACKED_ICE);
    assertThat(records)
        .singleElement()
        .satisfies(
            change -> {
              assertThat(change.actor()).isEqualTo("#storm-spells");
              assertThat(change.before().getMaterial()).isEqualTo(Material.STONE);
              assertThat(change.after().getMaterial()).isEqualTo(Material.PACKED_ICE);
            });
  }

  @Test
  void aRefusedAuditLeavesTheWorldUnchanged() {
    block.setType(Material.STONE);
    var changes =
        new AuditedBlockChanges(
            change -> {
              throw new IllegalStateException("audit queue unavailable");
            });
    assertThatThrownBy(
            () -> changes.set("#storm-mechanics", block, Material.AIR.createBlockData(), true))
        .hasMessage("audit queue unavailable");
    assertThat(block.getType()).isEqualTo(Material.STONE);
  }

  @Test
  void unchangedBlocksDoNotCreateAuditNoise() {
    block.setType(Material.STONE);
    var records = new ArrayList<AuditedBlockChanges.Change>();
    new AuditedBlockChanges(records::add).set("#storm-spells", block, block.getBlockData(), false);
    assertThat(records).isEmpty();
  }

  @Test
  void naturalBreakingIsAuditedBeforeTheNativeBreakAndPreservesItsResult() {
    var records = new ArrayList<AuditedBlockChanges.Change>();
    var natural =
        new org.mockbukkit.mockbukkit.block.BlockMock(Material.STONE, block.getLocation()) {
          @Override
          public boolean breakNaturally() {
            assertThat(getType()).isEqualTo(Material.STONE);
            assertThat(records)
                .singleElement()
                .satisfies(
                    change -> {
                      assertThat(change.before().getMaterial()).isEqualTo(Material.STONE);
                      assertThat(change.after().getMaterial()).isEqualTo(Material.AIR);
                      assertThat(change.actor()).isEqualTo("#storm-mechanics-crush");
                    });
            setType(Material.AIR);
            return true;
          }
        };
    assertThat(
            new AuditedBlockChanges(records::add).breakNaturally("#storm-mechanics-crush", natural))
        .isTrue();
    assertThat(natural.getType()).isEqualTo(Material.AIR);
  }

  @Test
  void aRefusedNaturalBreakAuditLeavesTheBlockAndDropsUntouched() {
    var natural =
        new org.mockbukkit.mockbukkit.block.BlockMock(Material.STONE, block.getLocation()) {
          @Override
          public boolean breakNaturally() {
            throw new AssertionError("A refused removal reached Paper's break operation");
          }
        };
    var changes =
        new AuditedBlockChanges(
            change -> {
              throw new IllegalStateException("audit queue unavailable");
            });
    assertThatThrownBy(() -> changes.breakNaturally("#storm-mechanics-crush", natural))
        .hasMessage("audit queue unavailable");
    assertThat(natural.getType()).isEqualTo(Material.STONE);
  }

  @Test
  void aLaterAuditRefusalLeavesEveryBlockInTheBatchUnchanged() {
    block.setType(Material.STONE);
    var second = block.getRelative(1, 0, 0);
    second.setType(Material.DIRT);
    var changes =
        new AuditedBlockChanges(
            change -> {
              if (change.before().getMaterial() == Material.DIRT) {
                throw new IllegalStateException("audit queue unavailable");
              }
            });
    assertThatThrownBy(
            () ->
                changes.prepare(
                    "#storm-mechanics",
                    List.of(
                        new BlockChanges.Update(block, Material.AIR.createBlockData(), false),
                        new BlockChanges.Update(second, Material.STONE.createBlockData(), false))))
        .hasMessage("audit queue unavailable");
    assertThat(block.getType()).isEqualTo(Material.STONE);
    assertThat(second.getType()).isEqualTo(Material.DIRT);
  }

  @Test
  void preparationIsSingleUseAndRejectsStaleWorldStateBeforeMutatingAnything() {
    block.setType(Material.STONE);
    var changes = new AuditedBlockChanges(change -> {});
    var prepared =
        changes.prepare(
            "#storm-mechanics",
            List.of(new BlockChanges.Update(block, Material.AIR.createBlockData(), false)));
    block.setType(Material.DIRT);
    assertThatThrownBy(prepared::apply).hasMessage("A prepared block changed before application");
    assertThat(block.getType()).isEqualTo(Material.DIRT);
    block.setType(Material.STONE);
    prepared.apply();
    assertThat(block.getType()).isEqualTo(Material.AIR);
    assertThatThrownBy(prepared::apply).hasMessage("A prepared block change can only run once");
  }

  @Test
  void duplicateTargetsAreRejectedBeforeAnythingIsLogged() {
    var changes =
        new AuditedBlockChanges(
            change -> {
              throw new AssertionError("A duplicate batch reached the recorder");
            });
    var update = new BlockChanges.Update(block, Material.STONE.createBlockData(), false);
    assertThatThrownBy(() -> changes.prepare("#storm-mechanics", List.of(update, update)))
        .hasMessage("A batch requires one final state per block");
  }

  @Test
  void backgroundThreadsCannotReadOrChangeTheWorld() {
    var changes =
        new AuditedBlockChanges(
            change -> {
              throw new AssertionError("An off-thread change reached the recorder");
            });
    var data = Material.AIR.createBlockData();
    assertThatThrownBy(
            () ->
                CompletableFuture.runAsync(() -> changes.set("#storm-spells", block, data, false))
                    .join())
        .hasCauseInstanceOf(IllegalStateException.class);
  }
}
