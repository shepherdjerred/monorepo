package com.shepherdjerred.thestorm.arena.domain.survival;

import static com.shepherdjerred.thestorm.arena.testing.Samples.ALICE;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

final class RustworksRulesTest {
  private static SurvivalContent settlement;
  private static SurvivalContent content;
  private static Map<BlockPos, String> blueprint;

  @BeforeAll
  static void authored() {
    var directory = Path.of("../../../server/owned/plugins/TheStorm/arena");
    settlement = ConfigFiles.load(directory.resolve("survival.yml"), SurvivalContent.class);
    content =
        ConfigFiles.load(directory.resolve("rustworks.yml"), SurvivalMapContent.class)
            .withRules(settlement);
    blueprint = SurvivalBlueprint.blocks(content);
  }

  @Test
  void moreLandHasSmallerPaidDistrictsAndSharedEquipmentRules() {
    assertThat(content.zones()).hasSize(24);
    assertThat(area(content.arena().region()))
        .isEqualTo((int) (area(settlement.arena().region()) * 1.5));
    var oldCombat =
        settlement.zones().stream()
            .flatMap(z -> z.areas().stream())
            .mapToInt(RustworksRulesTest::area)
            .sum();
    var newCombat =
        content.zones().stream()
            .flatMap(z -> z.areas().stream())
            .mapToInt(RustworksRulesTest::area)
            .sum();
    assertThat((double) newCombat / oldCombat).isBetween(1.5, 1.6);
    var average = (double) oldCombat / settlement.zones().size();
    assertThat(content.zones().stream().filter(z -> z.emeralds() > 0))
        .allSatisfy(
            zone ->
                assertThat(zone.areas().stream().mapToInt(RustworksRulesTest::area).sum() / average)
                    .isBetween(.5, .75));
    assertThat(content.recipes()).isEqualTo(settlement.recipes());
    assertThat(content.classes()).isEqualTo(settlement.classes());
    assertThat(content.legendaries()).isEqualTo(settlement.legendaries());
    assertThat(content.zones().stream().filter(z -> z.areas().size() > 1))
        .hasSizeGreaterThanOrEqualTo(10);
  }

  @Test
  void footprintIsBoundedAndEveryArrivalAndBankSurvivesDecoration() {
    assertThat(blueprint.size()).isLessThanOrEqualTo(SurvivalBlueprint.budget(content));
    var exit = content.arena().exit().point().block();
    assertThat(blueprint.keySet())
        .allSatisfy(
            pos ->
                assertThat(
                        content.arena().region().contains(pos)
                            || (pos.x() == exit.x()
                                && pos.z() == exit.z()
                                && Math.abs(pos.y() - exit.y()) <= 1))
                    .isTrue());
    assertThat(
            content.zones().stream()
                .flatMap(z -> z.stations().stream())
                .filter(s -> s.type() == SurvivalContent.StationType.BANK))
        .hasSize(3)
        .allSatisfy(bank -> assertThat(blueprint.get(bank.block())).isEqualTo("ENDER_CHEST"));
    for (var zone : content.zones()) {
      assertWalkable(zone.entrance().block());
      zone.safePoints().forEach(p -> assertWalkable(p.block()));
      zone.spawns().forEach(p -> assertWalkable(p.block()));
    }
    content.arena().playerSpawns().forEach(p -> assertWalkable(p.point().block()));
    assertWalkable(content.arena().lobby().point().block());
    assertWalkable(content.arena().spectator().point().block());
    assertWalkable(content.expedition().arrival().block());
    assertWalkable(content.expedition().returnTo().block());
    assertThat(blueprint.get(content.lobbyGuide())).isEqualTo("LECTERN");
    assertThat(blueprint.values()).doesNotContain("CUT_COPPER", "COPPER_GRATE", "COPPER_BLOCK");
  }

  @Test
  void purchasesOpenEveryDistrictAndDoNotAllowEarlyBypasses() {
    var state = new Settlement(content);
    var blocks = new HashMap<>(blueprint);
    var reachable = reachable(blocks);
    assertInitialGates(reachable);
    for (var zone : content.zones()) {
      if (zone.emeralds() == 0) continue;
      assertThat(state.unlockable(zone)).isTrue();
      for (var sign : zone.purchaseSigns()) assertAccessible(reachable, sign);
      state.unlock(zone);
      updateGates(state, blocks);
      reachable = reachable(blocks);
      assertThat(reachable)
          .as("Purchased district %s", zone.id())
          .contains(zone.entrance().block());
    }
    assertAllFixtures(reachable);
  }

  private static void assertInitialGates(Set<BlockPos> reachable) {
    for (var zone : content.zones()) {
      if (zone.emeralds() == 0) assertThat(reachable).contains(zone.entrance().block());
      else
        assertThat(reachable)
            .as("Locked district %s", zone.id())
            .doesNotContain(zone.entrance().block());
    }
  }

  private static void updateGates(Settlement state, Map<BlockPos, String> blocks) {
    for (var route : content.routes()) {
      if (route.districts().stream().allMatch(state::accessible))
        content.zones().stream()
            .filter(z -> z.id().equals(route.gateZone()))
            .findFirst()
            .orElseThrow()
            .gate()
            .forEach(p -> blocks.put(p, "AIR"));
    }
  }

  private static void assertAllFixtures(Set<BlockPos> reachable) {
    for (var zone : content.zones()) {
      for (var spawn : zone.spawns()) assertThat(reachable).contains(spawn.block());
      for (var point : zone.safePoints()) assertThat(reachable).contains(point.block());
      for (var station : zone.stations()) assertAccessible(reachable, station.block());
      for (var resource : zone.resources()) assertAccessible(reachable, resource.block());
    }
    for (var machine : content.machines()) assertAccessible(reachable, machine.block());
    for (var box : content.boxSites()) assertAccessible(reachable, box.block());
    for (var part : content.planeParts()) assertAccessible(reachable, part.block());
    assertAccessible(reachable, content.planeWorkbench());
    assertAccessible(reachable, content.bossObjective());
  }

  @Test
  void banksAndHarvestBudgetsAreIndependentBetweenMaps() {
    var one = new Settlement(content);
    var other = new Settlement(settlement);
    one.openAll();
    assertThat(other.open()).containsExactlyInAnyOrder("gatehouse", "market");
    var node = content.zones().getFirst().resources().getFirst();
    assertThat(one.harvest(ALICE, node)).isTrue();
    assertThat(one.harvest(ALICE, node)).isTrue();
    assertThat(one.harvest(ALICE, node)).isFalse();
    assertThat(other.harvest(ALICE, settlement.zones().getFirst().resources().getFirst())).isTrue();
    var kinds = content.zones().stream().flatMap(z -> z.resources().stream()).toList();
    assertThat(kinds.stream().map(SurvivalContent.Resource::material).distinct())
        .hasSize(ResourceKind.values().length);
    for (var kind : ResourceKind.values())
      assertThat(kinds.stream().filter(r -> r.material().equals(kind.name()))).hasSizeBetween(1, 2);
  }

  private static int area(Cuboid bounds) {
    return (bounds.max().x() - bounds.min().x() + 1) * (bounds.max().z() - bounds.min().z() + 1);
  }

  private static void assertWalkable(BlockPos pos) {
    assertThat(walkable(blueprint, pos)).as("Safe arrival at %s", pos).isTrue();
  }

  private static void assertAccessible(Set<BlockPos> reachable, BlockPos fixture) {
    assertThat(neighbors(fixture).stream().anyMatch(reachable::contains))
        .as("Reach fixture %s", fixture)
        .isTrue();
  }

  private static Set<BlockPos> reachable(Map<BlockPos, String> blocks) {
    var seen = new HashSet<BlockPos>();
    var pending = new ArrayDeque<BlockPos>();
    var start = content.arena().playerSpawns().getFirst().point().block();
    seen.add(start);
    pending.add(start);
    while (!pending.isEmpty()) {
      for (var next : neighbors(pending.removeFirst())) {
        if (walkable(blocks, next) && seen.add(next)) pending.add(next);
      }
    }
    return seen;
  }

  private static List<BlockPos> neighbors(BlockPos pos) {
    var result = new java.util.ArrayList<BlockPos>();
    for (var offset : new int[][] {{1, 0}, {-1, 0}, {0, 1}, {0, -1}})
      for (var rise = -1; rise <= 1; rise++)
        result.add(new BlockPos(pos.x() + offset[0], pos.y() + rise, pos.z() + offset[1]));
    return result;
  }

  private static boolean walkable(Map<BlockPos, String> blocks, BlockPos pos) {
    var floor = blocks.get(new BlockPos(pos.x(), pos.y() - 1, pos.z()));
    return passable(blocks.get(pos))
        && passable(blocks.get(new BlockPos(pos.x(), pos.y() + 1, pos.z())))
        && floor != null
        && !passable(floor);
  }

  private static boolean passable(@org.jspecify.annotations.Nullable String material) {
    return material != null
        && Set.of("AIR", "OAK_SIGN", "STONE_PRESSURE_PLATE", "RAIL").contains(material);
  }
}
