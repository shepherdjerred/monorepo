package com.shepherdjerred.thestorm.arena.domain.survival;

import static com.shepherdjerred.thestorm.arena.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.arena.testing.Samples.BOB;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class SettlementRulesTest {
  private static SurvivalContent shipped() {
    return ConfigFiles.load(
        Path.of("../../../server/owned/plugins/TheStorm/arena/survival.yml"),
        SurvivalContent.class);
  }

  @Test
  void budgetsArePersonalAndRefreshOnlyBetweenRounds() {
    var content = shipped();
    var settlement = new Settlement(content);
    var node = content.zones().getFirst().resources().getFirst();
    assertThat(settlement.harvest(ALICE, node)).isTrue();
    assertThat(settlement.harvest(ALICE, node)).isTrue();
    assertThat(settlement.harvest(ALICE, node)).isFalse();
    assertThat(settlement.harvest(BOB, node)).isTrue();
    settlement.nextRound();
    assertThat(settlement.harvest(ALICE, node)).isTrue();
  }

  @Test
  void unlocksAreSharedAndResetWithDefenseCharges() {
    var content = shipped();
    var settlement = new Settlement(content);
    var quarry =
        content.zones().stream().filter(z -> z.id().equals("quarry")).findFirst().orElseThrow();
    var foundry =
        content.zones().stream().filter(z -> z.id().equals("foundry")).findFirst().orElseThrow();
    assertThatThrownBy(() -> settlement.unlock(foundry)).isInstanceOf(IllegalStateException.class);
    settlement.unlock(quarry);
    settlement.unlock(foundry);
    assertThat(settlement.open()).contains("foundry");
    settlement.arm("market-trap");
    settlement.reset();
    assertThat(settlement.open()).containsExactlyInAnyOrder("gatehouse", "market");
    assertThat(settlement.strength("market-trap")).isZero();
    assertThat(settlement.strength("market-barricade")).isEqualTo(5);
  }

  @Test
  void blueprintHasEightReachableDistrictsAndFitsItsDeclaredBudget() {
    var content = shipped();
    var blueprint = new SettlementBlueprint(content).blocks();
    assertThat(content.zones()).hasSize(8);
    assertThat(blueprint.size()).isBetween(300_000, 500_000);
    for (var zone : content.zones()) {
      var spawn = zone.entrance().block();
      assertThat(blueprint.get(spawn)).isEqualTo("AIR");
      assertThat(
              blueprint.get(
                  new com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos(
                      spawn.x(), spawn.y() - 1, spawn.z())))
          .isEqualTo("STONE_BRICKS");
    }
    assertThat(content.arena().region().max().x() - content.arena().region().min().x() + 1)
        .isEqualTo(160);
  }

  @Test
  void unlockedRoutesReachEveryEntranceStationAndTheMineFloor() {
    var content = shipped();
    var blocks = new HashMap<>(new SettlementBlueprint(content).blocks());
    content.zones().forEach(zone -> zone.gate().forEach(pos -> blocks.put(pos, "AIR")));
    var reachable = reachable(blocks, content.arena().playerSpawns().getFirst().point().block());
    for (var zone : content.zones()) {
      assertThat(reachable).contains(zone.entrance().block());
      for (var station : zone.stations()) {
        assertThat(neighbors(station.block()).stream().anyMatch(reachable::contains))
            .as("Reach station in %s", zone.id())
            .isTrue();
      }
    }
    var quarry =
        content.zones().stream().filter(z -> z.id().equals("quarry")).findFirst().orElseThrow();
    var min = quarry.bounds().min();
    assertThat(reachable).contains(new BlockPos(min.x() + 21, 67, min.z() + 32));
  }

  private static Set<BlockPos> reachable(Map<BlockPos, String> blocks, BlockPos start) {
    var seen = new HashSet<BlockPos>();
    var pending = new ArrayDeque<BlockPos>();
    seen.add(start);
    pending.add(start);
    while (!pending.isEmpty()) {
      for (var next : neighbors(pending.removeFirst())) {
        if (walkable(blocks, next) && seen.add(next)) {
          pending.add(next);
        }
      }
    }
    return seen;
  }

  private static java.util.List<BlockPos> neighbors(BlockPos pos) {
    var result = new java.util.ArrayList<BlockPos>();
    for (var offset : new int[][] {{1, 0}, {-1, 0}, {0, 1}, {0, -1}}) {
      for (var rise = -1; rise <= 1; rise++) {
        result.add(new BlockPos(pos.x() + offset[0], pos.y() + rise, pos.z() + offset[1]));
      }
    }
    return result;
  }

  private static boolean walkable(Map<BlockPos, String> blocks, BlockPos pos) {
    var feet = blocks.get(pos);
    var head = blocks.get(new BlockPos(pos.x(), pos.y() + 1, pos.z()));
    var floor = blocks.get(new BlockPos(pos.x(), pos.y() - 1, pos.z()));
    return passable(feet) && passable(head) && floor != null && !passable(floor);
  }

  private static boolean passable(@org.jspecify.annotations.Nullable String material) {
    return "AIR".equals(material)
        || "OAK_SIGN".equals(material)
        || "STONE_PRESSURE_PLATE".equals(material);
  }
}
