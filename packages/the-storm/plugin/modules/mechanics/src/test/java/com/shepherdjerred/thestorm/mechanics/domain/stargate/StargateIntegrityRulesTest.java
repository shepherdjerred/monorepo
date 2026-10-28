package com.shepherdjerred.thestorm.mechanics.domain.stargate;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.mechanics.domain.TestGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Mount;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class StargateIntegrityRulesTest {
  @Test
  void rejectsChangedSignButtonFrameOrInterior() {
    var frame = new StargateFrame(new Pos(0, 64, 0), Direction.EAST);
    var network = new StargateNetwork(new UUID(0, 1), "Roads", new NetworkAccess.Public());
    var gate =
        new Stargate(
            new UUID(0, 2),
            network.id(),
            "Home",
            new UUID(0, 3),
            new UUID(0, 4),
            new Pos(-1, 66, -1),
            frame,
            null,
            false);
    var sign =
        new SignView(List.of("Home", "", "Roads", ""), Mount.WALL, Optional.of(Direction.NORTH));
    var grid = new TestGrid();
    frame.frameBlocks().forEach(pos -> grid.solid(pos, "minecraft:obsidian"));
    assertThat(
            StargateIntegrityRules.valid(
                new StargateIntegrityRules.Inspection(grid, gate, network, sign, true), false))
        .isTrue();
    grid.solid(frame.interior().getFirst(), "minecraft:nether_portal");
    assertThat(
            StargateIntegrityRules.recoverable(
                new StargateIntegrityRules.Inspection(grid, gate, network, sign, true)))
        .isTrue();
    grid.air(frame.interior().getFirst());
    assertThat(
            StargateIntegrityRules.valid(
                new StargateIntegrityRules.Inspection(grid, gate, network, sign, false), false))
        .isFalse();
    var wrong =
        new SignView(List.of("Other", "", "Roads", ""), Mount.WALL, Optional.of(Direction.NORTH));
    assertThat(
            StargateIntegrityRules.valid(
                new StargateIntegrityRules.Inspection(grid, gate, network, wrong, true), false))
        .isFalse();
    grid.solid(frame.interior().getFirst(), "minecraft:stone");
    assertThat(
            StargateIntegrityRules.valid(
                new StargateIntegrityRules.Inspection(grid, gate, network, sign, true), false))
        .isFalse();
    grid.air(frame.interior().getFirst());
    grid.air(frame.frameBlocks().getFirst());
    assertThat(
            StargateIntegrityRules.valid(
                new StargateIntegrityRules.Inspection(grid, gate, network, sign, true), false))
        .isFalse();
  }
}
