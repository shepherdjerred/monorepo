package com.shepherdjerred.thestorm.towns.domain.region;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Region areas, allowances, validation and the region index. */
final class RegionTest {

  private static final ChunkRange SPAWN_CHUNKS =
      new ChunkRange("world", new ChunkCorner(-2, -2), new ChunkCorner(1, 1));

  private static final Cuboid SHOP =
      new Cuboid("world", new BlockCorner(0, 60, 0), new BlockCorner(4, 70, 4));

  private static AdminRegion region(String id, Area area, RegionAllowance... allow) {
    var areas =
        switch (area) {
          case ChunkRange chunks -> new RegionAreas(List.of(chunks), List.of());
          case Cuboid cuboid -> new RegionAreas(List.of(), List.of(cuboid));
        };
    return new AdminRegion(id, id.toUpperCase(java.util.Locale.ROOT), areas, List.of(allow));
  }

  @Test
  void aChunkRangeCoversWholeChunksAtEveryHeight() {
    assertThat(SPAWN_CHUNKS.contains(new BlockPos("world", -32, -64, -32))).isTrue();
    assertThat(SPAWN_CHUNKS.contains(new BlockPos("world", 31, 319, 31))).isTrue();
    assertThat(SPAWN_CHUNKS.contains(new BlockPos("world", 32, 64, 0))).isFalse();
    assertThat(SPAWN_CHUNKS.contains(new BlockPos("world", -33, 64, 0))).isFalse();
    assertThat(SPAWN_CHUNKS.contains(new BlockPos("world_nether", 0, 64, 0))).isFalse();
    assertThat(SPAWN_CHUNKS.footprint()).hasSize(16);
    assertThat(SPAWN_CHUNKS.footprintSize()).isEqualTo(16);
  }

  @Test
  void aCuboidIsInclusiveOnEveryAxis() {
    assertThat(SHOP.contains(new BlockPos("world", 0, 60, 0))).isTrue();
    assertThat(SHOP.contains(new BlockPos("world", 4, 70, 4))).isTrue();
    assertThat(SHOP.contains(new BlockPos("world", 5, 65, 2))).isFalse();
    assertThat(SHOP.contains(new BlockPos("world", 2, 59, 2))).isFalse();
    assertThat(SHOP.contains(new BlockPos("world", 2, 71, 2))).isFalse();
    assertThat(SHOP.footprint()).containsExactly(new ChunkPos("world", 0, 0));
    var spanning = new Cuboid("world", new BlockCorner(-1, 0, 15), new BlockCorner(15, 0, 16));
    assertThat(spanning.footprint()).hasSize(4);
    assertThat(spanning.footprintSize()).isEqualTo(4);
  }

  @Test
  void invertedAreasAreRejected() {
    assertThatThrownBy(() -> new ChunkRange("world", new ChunkCorner(1, 0), new ChunkCorner(0, 0)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () -> new Cuboid("world", new BlockCorner(0, 10, 0), new BlockCorner(0, 9, 0)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new RegionAreas(List.of(), List.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void allowancesMatchActionAndSubject() {
    var doors = new RegionAllowance(Action.INTERACT, Set.of(Subject.DOOR, Subject.BUTTON));
    var anything = new RegionAllowance(Action.OPEN_CONTAINER, Set.of(Subject.ANY));

    assertThat(doors.permits(new Act(Action.INTERACT, Subject.DOOR))).isTrue();
    assertThat(doors.permits(new Act(Action.INTERACT, Subject.LEVER))).isFalse();
    assertThat(doors.permits(new Act(Action.BREAK, Subject.DOOR))).isFalse();
    assertThat(anything.permits(new Act(Action.OPEN_CONTAINER, Subject.CONTAINER))).isTrue();
    assertThat(anything.permits(new Act(Action.INTERACT, Subject.CONTAINER))).isFalse();
  }

  @Test
  void allowancesNeedSubjectsAndAnyStandsAlone() {
    assertThatThrownBy(() -> new RegionAllowance(Action.BUILD, Set.of()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new RegionAllowance(Action.BUILD, Set.of(Subject.ANY, Subject.DOOR)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void regionIdsAndNamesAreValidated() {
    assertThatThrownBy(() -> region("Spawn!", SPAWN_CHUNKS))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new AdminRegion(
                    "spawn", " ", new RegionAreas(List.of(SPAWN_CHUNKS), List.of()), List.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void theIndexFindsTheFirstListedRegionAtABlock() {
    var shop =
        region("shop", SHOP, new RegionAllowance(Action.OPEN_CONTAINER, Set.of(Subject.ANY)));
    var spawn = region("spawn", SPAWN_CHUNKS);
    var index = new RegionIndex(List.of(shop, spawn));

    assertThat(index.at("world", 2, 65, 2)).contains(shop);
    assertThat(index.at("world", 2, 80, 2)).contains(spawn);
    assertThat(index.at("world", -20, 0, -20)).contains(spawn);
    assertThat(index.at("world", 40, 64, 40)).isEmpty();
    assertThat(index.at("world_nether", 2, 65, 2)).isEmpty();
    assertThat(index.byId("spawn")).contains(spawn);
    assertThat(index.byId("arena")).isEmpty();
    assertThat(index.all()).containsExactly(shop, spawn);
  }

  @Test
  void theIndexReportsRegionsOverlappingAChunk() {
    var index = new RegionIndex(List.of(region("shop", SHOP)));

    assertThat(index.overlapping(new ChunkPos("world", 0, 0))).isPresent();
    assertThat(index.overlapping(new ChunkPos("world", 1, 0))).isEmpty();
    assertThat(index.overlapping(new ChunkPos("world_nether", 0, 0))).isEmpty();
  }
}
