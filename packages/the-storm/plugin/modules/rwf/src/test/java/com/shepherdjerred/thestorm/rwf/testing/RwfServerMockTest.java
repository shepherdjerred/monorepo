package com.shepherdjerred.thestorm.rwf.testing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.papermc.paper.datacomponent.DataComponentTypes;
import io.papermc.paper.scoreboard.numbers.NumberFormat;
import java.util.Objects;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.bukkit.scoreboard.Criteria;
import org.bukkit.scoreboard.DisplaySlot;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;

/** The added fixture APIs preserve Paper state rather than swallowing unsupported operations. */
final class RwfServerMockTest {
  private ServerMock server;

  @BeforeEach
  void start() {
    server = MockBukkit.mock(RwfServerMock.create());
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void numberFormatsRemainAttachedToRegisteredObjectivesAndScoresResetFully() {
    var board = server.getScoreboardManager().getNewScoreboard();
    var sidebar = board.registerNewObjective("rwf", Criteria.DUMMY, Component.text("RWF"));
    assertThat(sidebar.numberFormat()).isNull();
    sidebar.numberFormat(NumberFormat.blank());
    sidebar.setDisplaySlot(DisplaySlot.SIDEBAR);
    assertThat(board.getObjective(DisplaySlot.SIDEBAR)).isSameAs(sidebar);
    assertThat(board.getObjective("rwf")).isSameAs(sidebar);
    assertThat(sidebar.numberFormat()).isEqualTo(NumberFormat.blank());
    sidebar.getScore("row").setScore(7);
    assertThat(board.getEntries()).contains("row");
    board.resetScores("row");
    assertThat(sidebar.getScore("row").isScoreSet()).isFalse();
    assertThat(board.getEntries()).doesNotContain("row");
    sidebar.numberFormat(null);
    assertThat(sidebar.numberFormat()).isNull();
    sidebar.unregister();
    assertThat(board.getObjective("rwf")).isNull();
    assertThat(board.getObjective(DisplaySlot.SIDEBAR)).isNull();
    assertThatThrownBy(sidebar::numberFormat).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void nativeInventoryClonesPreserveEveryExplicitComponentIndependently() {
    var original = ItemStack.of(Material.TIPPED_ARROW, 8);
    original.setData(DataComponentTypes.POTION_DURATION_SCALE, 1.0f);
    original.setData(DataComponentTypes.MAX_STACK_SIZE, 32);
    var player = server.addPlayer();
    player.getInventory().setItem(3, new ComponentStack(original));
    var stored = Objects.requireNonNull(player.getInventory().getItem(3));
    assertThat(stored.getData(DataComponentTypes.POTION_DURATION_SCALE)).isEqualTo(1.0f);
    assertThat(stored.getData(DataComponentTypes.MAX_STACK_SIZE)).isEqualTo(32);
    original.setData(DataComponentTypes.POTION_DURATION_SCALE, 0.5f);
    assertThat(stored.getData(DataComponentTypes.POTION_DURATION_SCALE)).isEqualTo(1.0f);
  }
}
