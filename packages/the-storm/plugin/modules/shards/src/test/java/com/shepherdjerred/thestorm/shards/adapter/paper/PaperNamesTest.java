package com.shepherdjerred.thestorm.shards.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.shards.domain.AltarLocation;
import com.shepherdjerred.thestorm.shards.domain.DropRule;
import com.shepherdjerred.thestorm.shards.domain.DropsConfig;
import com.shepherdjerred.thestorm.shards.domain.ShardsConfig;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Material;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

final class PaperNamesTest {

  /** Until the manager sets the real windmill coordinates, the placeholder altar fails. */
  private static final String PLACEHOLDER_ALTAR =
      "altars: expected EMERALD_BLOCK at minecraft:overworld -71 74 -243 but found AIR";

  private final Harness harness = new Harness();
  // MockBukkit creates only the overworld. Keep the shipped rules and point their world list at
  // that loaded fixture world when checking names.
  private final ShardsConfig shipped = inLoadedWorld(harness.config);

  private ShardsConfig inLoadedWorld(ShardsConfig config) {
    var drops = config.drops();
    return new ShardsConfig(
        config.item(),
        new DropsConfig(
            List.of(harness.world.getKey().asString()),
            drops.excludedSpawnReasons(),
            drops.mobs(),
            drops.blocks()),
        config.upgrades(),
        config.altars(),
        config.bonuses(),
        config.messages());
  }

  @AfterEach
  void tearDown() {
    harness.close();
  }

  private ShardsConfig withAltar(AltarLocation altar) {
    return new ShardsConfig(
        shipped.item(),
        shipped.drops(),
        shipped.upgrades(),
        List.of(altar),
        shipped.bonuses(),
        shipped.messages());
  }

  private AltarLocation altarAt(int x, String material) {
    return new AltarLocation(harness.world.getKey().asString(), x, 64, 0, material);
  }

  @Test
  void everyShippedNameExistsAndOnlyThePlaceholderAltarIsMissing() {
    assertThat(PaperNames.problems(shipped, harness.server)).isEmpty();
    assertThat(PaperNames.altarProblemsAsync(shipped, this::block).join())
        .containsExactly(PLACEHOLDER_ALTAR);
  }

  @Test
  void typosAndPreFlatteningNamesAreReported() {
    var rule = new DropRule(0.01, 1, 1);
    var broken =
        new ShardsConfig(
            shipped.item(),
            new DropsConfig(
                shipped.drops().worlds(),
                List.of("SPAWNR"),
                Map.of("PIG_ZOMBIE", rule, "ZOMBIE", rule),
                Map.of("DIAMOND_ORE", rule, "WOOD_SWORD", rule)),
            shipped.upgrades(),
            shipped.altars(),
            shipped.bonuses(),
            shipped.messages());

    assertThat(PaperNames.problems(broken, harness.server))
        .containsExactlyInAnyOrder(
            "drops.mobs: unknown name PIG_ZOMBIE",
            "drops.blocks: unknown name WOOD_SWORD",
            "drops.excludedSpawnReasons: unknown name SPAWNR");
  }

  @Test
  void unknownDropWorldsAndOversizedDropsAreReportedAtStartup() {
    var oversized = new DropRule(0.01, 1, 65);
    var broken =
        new ShardsConfig(
            shipped.item(),
            new DropsConfig(
                List.of(harness.world.getKey().asString(), "minecraft:missing"),
                shipped.drops().excludedSpawnReasons(),
                Map.of("ZOMBIE", oversized),
                Map.of("DIAMOND_ORE", oversized)),
            shipped.upgrades(),
            shipped.altars(),
            shipped.bonuses(),
            shipped.messages());

    assertThat(PaperNames.problems(broken, harness.server))
        .containsExactlyInAnyOrder(
            "drops.worlds: unknown name minecraft:missing",
            "drops.mobs.ZOMBIE: maximum 65 exceeds shard stack size 64",
            "drops.blocks.DIAMOND_ORE: maximum 65 exceeds shard stack size 64");
  }

  @Test
  void anAltarOnTheConfiguredBlockPasses() {
    harness.world.getBlockAt(3, 64, 0).setType(Material.EMERALD_BLOCK);

    assertThat(
            PaperNames.altarProblemsAsync(withAltar(altarAt(3, "EMERALD_BLOCK")), this::block)
                .join())
        .isEmpty();
  }

  @Test
  void anAltarOnAnyOtherBlockFailsWithItsCoordinates() {
    harness.world.getBlockAt(3, 64, 0).setType(Material.DIRT);
    var world = harness.world.getKey().asString();

    assertThat(
            PaperNames.altarProblemsAsync(withAltar(altarAt(3, "EMERALD_BLOCK")), this::block)
                .join())
        .containsExactly("altars: expected EMERALD_BLOCK at " + world + " 3 64 0 but found DIRT");
  }

  @Test
  void anAltarMaterialMustBeABlock() {
    var world = harness.world.getKey().asString();

    assertThat(PaperNames.problems(withAltar(altarAt(3, "DIAMOND_SWORD")), harness.server))
        .containsExactly("altars: DIAMOND_SWORD at " + world + " 3 64 0 is not a block");
  }

  private CompletableFuture<String> block(AltarLocation altar) {
    return CompletableFuture.completedFuture(
        harness.world.getBlockAt(altar.x(), altar.y(), altar.z()).getType().name());
  }
}
