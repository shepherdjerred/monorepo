package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.app.NavCatalog;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class DoorNavigationTest {
  private static final BlockPos DOOR = new BlockPos(8, 1, 0);
  private static final BlockClassification HOUSE =
      new BlockClassification() {
        @Override
        public GridBounds bounds() {
          return new GridBounds(new BlockPos(0, 0, 0), 17, 4, 1);
        }

        @Override
        public BlockShape shape(int x, int y, int z) {
          if (y == 0 || y == 3) return BlockShape.FULL;
          return x == DOOR.x() ? BlockShape.DOOR : BlockShape.PASSABLE;
        }

        @Override
        public boolean blocksSight(int x, int y, int z) {
          return shape(x, y, z).blocksProjectile();
        }
      };

  @Test
  void woodenDoorAllowsPlanningButBlocksActualSightAndProjectilesUntilOpened() {
    var graph = NavGraphBuilder.build(HOUSE);
    var left = graph.nodeAt(new BlockPos(2, 1, 0)).orElseThrow();
    var right = graph.nodeAt(new BlockPos(14, 1, 0)).orElseThrow();
    assertThat(graph.path(left, right)).isPresent();
    var closed = VoxelGrid.from(HOUSE);
    var from = new Vec3(2.5, 2.62, 0.5);
    var to = new Vec3(14.5, 2.62, 0.5);
    assertThat(closed.canSee(from, to)).isFalse();
    assertThat(closed.raycast(from, to, VoxelGrid.Layer.PROJECTILE)).contains(DOOR.up());
    var possible = Regions.build(graph, closed.potentialSight());
    assertThat(possible.canSee(possible.regionOf(left), possible.regionOf(right))).isTrue();
    var open = closed.withDoorState(DOOR, true);
    assertThat(open.canSee(from, to)).isTrue();
    assertThat(open.raycast(from, to, VoxelGrid.Layer.PROJECTILE)).isEmpty();
    assertThat(open.withDoorState(DOOR, false)).isEqualTo(closed);
    assertThat(closed.canSee(from, to)).isFalse();
  }

  @Test
  void nextMatchRestoresTheDecodedClosedDoorBaseline() {
    var sites =
        new NavSites(
            List.of(new NavSites.Site("spawn", Optional.of("red"), new BlockPos(2, 1, 0))),
            List.of());
    var baseline = MapBaker.bake("house", HOUSE, sites);
    var catalog = new NavCatalog();
    catalog.add(baseline);
    assertThat(catalog.confirm(baseline.mapId(), baseline.blocksSha256())).isEmpty();
    catalog.observed(baseline.withGrid(baseline.grid().withDoorState(DOOR, true)));
    assertThat(catalog.forMap("house").orElseThrow().grid().blocks(DOOR, VoxelGrid.Layer.SIGHT))
        .isFalse();
    assertThat(catalog.decoded().get("house")).isSameAs(baseline);
    assertThat(catalog.confirm(baseline.mapId(), baseline.blocksSha256())).isEmpty();
    assertThat(catalog.forMap("house")).contains(baseline);
    catalog.evict("house");
    assertThat(catalog.forMap("house")).isEmpty();
    assertThat(catalog.decoded()).isEmpty();
  }
}
