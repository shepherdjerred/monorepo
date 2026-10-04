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
  void duplicateNodesShareABudgetAndUpgradesRequireWorkshopAccess() {
    var content = shipped();
    var settlement = new Settlement(content);
    var wood =
        content.zones().stream()
            .flatMap(z -> z.resources().stream())
            .filter(r -> r.material().equals("OAK_PLANKS"))
            .toList();
    assertThat(wood).hasSize(2);
    assertThat(settlement.harvest(ALICE, wood.getFirst())).isTrue();
    assertThat(settlement.harvest(ALICE, wood.getLast())).isTrue();
    assertThat(settlement.available(ALICE, wood.getFirst())).isFalse();
    assertThat(settlement.canUpgrade(wood.getFirst())).isFalse();
    settlement.openAll();
    settlement.upgrade(wood.getFirst());
    assertThat(settlement.harvestAmount(wood.getFirst())).isEqualTo(6);
    assertThat(settlement.harvestAmount(wood.getLast())).isEqualTo(4);
    settlement.upgrade(wood.getFirst());
    assertThat(settlement.harvestAmount(wood.getFirst())).isEqualTo(8);
    assertThat(settlement.canUpgrade(wood.getFirst())).isFalse();
    settlement.reset();
    assertThat(settlement.resourceTier(wood.getFirst())).isEqualTo(1);
  }

  @Test
  void suppliesAndRecipesOfferProgressionWithoutMultiplyingHarvestSites() {
    var content = shipped();
    var nodes = content.zones().stream().flatMap(z -> z.resources().stream()).toList();
    assertThat(nodes).hasSize(15);
    assertThat(nodes.stream().map(SurvivalContent.Resource::material).distinct()).hasSize(12);
    assertThat(
            content.zones().stream()
                .flatMap(z -> z.stations().stream())
                .filter(s -> s.type() == SurvivalContent.StationType.BANK))
        .hasSize(3);
    for (var tier : java.util.List.of("LEATHER", "CHAINMAIL", "IRON", "DIAMOND")) {
      for (var slot : java.util.List.of("HELMET", "CHESTPLATE", "LEGGINGS", "BOOTS"))
        assertThat(content.recipes()).anyMatch(r -> r.material().equals(tier + "_" + slot));
    }
    assertThat(content.recipes())
        .allSatisfy(
            r ->
                assertThat(
                        r.ingredients().keySet().stream()
                            .filter(material -> !material.equals("EMERALD")))
                    .hasSizeLessThanOrEqualTo(3));
    assertThat(content.recipes().stream().map(SurvivalContent.Recipe::potion).distinct())
        .containsExactlyInAnyOrder(SurvivalContent.PotionKind.values());
  }

  @Test
  void blueprintHasTenReachableDistrictsAndFitsItsDeclaredBudget() {
    var content = shipped();
    var blueprint = new SettlementBlueprint(content).blocks();
    assertThat(content.zones()).hasSize(10);
    assertThat(blueprint.size())
        .isEqualTo(532_765)
        .isLessThanOrEqualTo(SettlementBlueprint.BLOCK_BUDGET);
    var exit = content.arena().exit().point().block();
    assertThat(blueprint.keySet())
        .allSatisfy(
            pos ->
                assertThat(
                        content.arena().region().contains(pos)
                            || (pos.x() == exit.x()
                                && pos.z() == exit.z()
                                && Math.abs(pos.y() - exit.y()) <= 1))
                    .as("Reviewed footprint at %s", pos)
                    .isTrue());
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
  void arrivalPadsPreserveAllThreeBanks() {
    var content = shipped();
    var blueprint = new SettlementBlueprint(content).blocks();
    var banks =
        content.zones().stream()
            .flatMap(zone -> zone.stations().stream())
            .filter(station -> station.type() == SurvivalContent.StationType.BANK)
            .toList();
    assertThat(banks)
        .hasSize(3)
        .allSatisfy(bank -> assertThat(blueprint.get(bank.block())).isEqualTo("ENDER_CHEST"));
    content.zones().stream()
        .flatMap(zone -> zone.safePoints().stream())
        .forEach(point -> assertThat(blueprint.get(point.block())).isEqualTo("AIR"));
  }

  @Test
  void unlockedRoutesReachEveryEntranceStationAndTheMineFloor() {
    var content = shipped();
    var blocks = new HashMap<>(new SettlementBlueprint(content).blocks());
    content.zones().forEach(zone -> zone.gate().forEach(pos -> blocks.put(pos, "AIR")));
    var reachable = reachable(blocks, content.arena().playerSpawns().getFirst().point().block());
    for (var zone : content.zones()) {
      assertThat(reachable).contains(zone.entrance().block());
      assertThat(zone.spawns())
          .allSatisfy(
              point ->
                  assertThat(reachable)
                      .as("Spawn in %s at %s", zone.id(), point)
                      .contains(point.block()));
      assertThat(zone.safePoints())
          .allSatisfy(
              point ->
                  assertThat(reachable)
                      .as("Rescue in %s at %s", zone.id(), point)
                      .contains(point.block()));
      for (var station : zone.stations()) {
        assertThat(neighbors(station.block()).stream().anyMatch(reachable::contains))
            .as("Reach station in %s", zone.id())
            .isTrue();
      }
    }
    assertThat(reachable).contains(new BlockPos(1834, 67, 2165));
    assertThat(reachable).contains(new BlockPos(1800, 88, 2244));
    assertThat(content.boxSites())
        .allSatisfy(
            site ->
                assertThat(neighbors(site.block()).stream().anyMatch(reachable::contains))
                    .as("Reach box %s", site.id())
                    .isTrue());
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
