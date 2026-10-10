package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class BombApproachTest {
  private static final BlockPos BOMB = new BlockPos(4, 2, 4);
  private static final BlockClassification MAP =
      new BlockClassification() {
        @Override
        public GridBounds bounds() {
          return new GridBounds(new BlockPos(0, 0, 0), 9, 5, 9);
        }

        @Override
        public BlockShape shape(int x, int y, int z) {
          return y == 0 || (x == 4 && z == 4 && y <= 2) ? BlockShape.FULL : BlockShape.PASSABLE;
        }

        @Override
        public boolean blocksSight(int x, int y, int z) {
          return shape(x, y, z) == BlockShape.FULL;
        }
      };

  @Test
  void elevatedBombUsesAReachableSideInsteadOfItsInaccessibleTop() {
    var spawn = new NavSites.Site("red-spawn", Optional.of("red"), new BlockPos(0, 1, 0));
    var bomb = new NavSites.Site("blue-bomb", Optional.of("blue"), BOMB);
    var nav = MapBaker.bake("pillar", MAP, new NavSites(List.of(spawn), List.of(bomb)));
    assertThat(nav.graph().nearestNode(BOMB.feet())).isPresent();
    var top = nav.graph().nodeAt(BOMB.up()).orElseThrow();
    var from = nav.graph().nodeAt(spawn.cell()).orElseThrow();
    assertThat(nav.graph().path(from, top)).isEmpty();
    var approach = nav.approachNode(bomb).orElseThrow();
    assertThat(nav.graph().cell(approach).y()).isEqualTo(1);
    assertThat(nav.graph().path(from, approach)).isPresent();
    assertThat(nav.distanceTo(bomb.name()).at(approach)).isZero();
    assertThat(nav.validate()).isEmpty();
    assertThat(nav.routes().between(spawn.name(), bomb.name()))
        .allMatch(route -> route.nodes().getLast() == approach);
    var eye = nav.graph().feet(approach).plus(0, 1.62, 0);
    assertThat(eye.distance(BOMB.center())).isLessThanOrEqualTo(3);
    assertThat(nav.grid().raycast(eye, BOMB.center(), VoxelGrid.Layer.PROJECTILE)).contains(BOMB);
  }
}
