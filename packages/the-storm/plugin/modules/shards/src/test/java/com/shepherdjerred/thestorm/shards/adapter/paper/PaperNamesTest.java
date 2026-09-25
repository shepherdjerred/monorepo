package com.shepherdjerred.thestorm.shards.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.shards.domain.DropRule;
import com.shepherdjerred.thestorm.shards.domain.DropsConfig;
import com.shepherdjerred.thestorm.shards.domain.ShardsConfig;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;

final class PaperNamesTest {

  private ServerMock server;
  private ShardsConfig shipped;

  @BeforeEach
  void setUp() {
    server = MockBukkit.mock();
    shipped =
        ConfigFiles.load(
            Path.of(Objects.requireNonNull(System.getProperty("thestorm.shards.config"))),
            ShardsConfig.class);
  }

  @AfterEach
  void tearDown() {
    MockBukkit.unmock();
  }

  @Test
  void everyShippedNameExistsInThisVersionExceptTheUnloadedWorld() {
    assertThat(PaperNames.problems(shipped, server))
        .containsExactly("altars: world minecraft:overworld is not loaded");
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

    assertThat(PaperNames.problems(broken, server))
        .containsExactlyInAnyOrder(
            "drops.mobs: unknown name PIG_ZOMBIE",
            "drops.blocks: unknown name WOOD_SWORD",
            "drops.excludedSpawnReasons: unknown name SPAWNR",
            "altars: world minecraft:overworld is not loaded");
  }
}
