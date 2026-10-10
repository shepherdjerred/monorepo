package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.BitSet;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class BotTickerTest {
  @Test
  void anEnemyThatMovesBehindCoverCannotBeRefreshedFromTheGlobalSnapshot() {
    var self = combatant(1, RED, new Vec3(1.5, 1, 1.5));
    var oldEnemy = combatant(2, BLUE, new Vec3(1.5, 1, 2.5));
    var enemy = combatant(2, BLUE, new Vec3(1.5, 1, 6.5));
    var snapshot =
        new WorldSnapshot(
            20,
            MatchPhase.LIVE,
            List.of(self, enemy),
            List.of(),
            PoisonView.NONE,
            "test",
            List.of());
    var input =
        new ReflexInput(self, snapshot, Decision.idle(self.id(), 19, 0), Optional.of(oldEnemy), 0);
    var bounds = new GridBounds(new BlockPos(0, 0, 0), 10, 5, 10);
    var empty = new BitSet();
    assertThat(BotTicker.freshTarget(input, new VoxelGrid(bounds, empty, empty, empty)).target())
        .contains(enemy);
    var wall = new BitSet();
    for (var y = 0; y < 5; y++) wall.set(bounds.index(1, y, 4));
    assertThat(BotTicker.freshTarget(input, new VoxelGrid(bounds, empty, wall, empty)).target())
        .isEmpty();
  }
}
