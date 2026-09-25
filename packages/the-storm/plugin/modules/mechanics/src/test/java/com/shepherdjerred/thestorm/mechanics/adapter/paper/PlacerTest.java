package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.structure.BlockChange;
import com.shepherdjerred.thestorm.mechanics.domain.structure.Structure;
import java.util.List;
import org.bukkit.Material;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.world.WorldMock;

/** Placing structure changes: everything is checked before the first block is touched. */
final class PlacerTest {

  private static final String PLANKS = "minecraft:oak_planks";
  private static final Pos TEMPLATE = new Pos(0, 64, 0);
  private static final Pos FIRST = new Pos(1, 64, 0);
  private static final Pos SECOND = new Pos(2, 64, 0);

  private WorldMock world;
  private PaperGrid grid;

  @BeforeEach
  void start() {
    var server = MockBukkit.mock();
    world = server.addSimpleWorld("world");
    grid = new PaperGrid(world);
    grid.block(TEMPLATE).setType(Material.OAK_PLANKS);
    grid.block(FIRST).setType(Material.OAK_PLANKS);
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  private static Structure bridge() {
    return new Structure(PLANKS, TEMPLATE, List.of(FIRST, SECOND));
  }

  @Test
  void aStaleChangeFailsBeforeAnyBlockMoves() {
    grid.block(SECOND).setType(Material.STONE);
    var changes =
        List.of(
            new BlockChange(FIRST, PLANKS, Cell.AIR), new BlockChange(SECOND, PLANKS, Cell.AIR));

    assertThatThrownBy(() -> Placer.check(grid, bridge(), changes))
        .isInstanceOf(IllegalStateException.class);

    assertThat(grid.block(FIRST).getType()).isEqualTo(Material.OAK_PLANKS);
    assertThat(grid.block(SECOND).getType()).isEqualTo(Material.STONE);
  }

  @Test
  void aTemplateOfAnotherMaterialFailsBeforeAnyBlockMoves() {
    grid.block(TEMPLATE).setType(Material.OAK_SLAB);
    var changes = List.of(new BlockChange(FIRST, PLANKS, Cell.AIR));

    assertThatThrownBy(() -> Placer.check(grid, bridge(), changes))
        .isInstanceOf(IllegalStateException.class);

    assertThat(grid.block(FIRST).getType()).isEqualTo(Material.OAK_PLANKS);
  }

  @Test
  void checkedChangesApply() {
    var changes =
        List.of(
            new BlockChange(FIRST, PLANKS, Cell.AIR), new BlockChange(SECOND, Cell.AIR, PLANKS));

    Placer.check(grid, bridge(), changes).apply();

    assertThat(grid.block(FIRST).getType()).isEqualTo(Material.AIR);
    assertThat(grid.block(SECOND).getType()).isEqualTo(Material.OAK_PLANKS);
  }
}
