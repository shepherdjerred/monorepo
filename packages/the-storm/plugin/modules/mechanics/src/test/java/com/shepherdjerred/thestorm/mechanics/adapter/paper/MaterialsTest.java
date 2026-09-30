package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.mechanics.domain.config.Access;
import com.shepherdjerred.thestorm.mechanics.domain.config.MechanicsConfig;
import com.shepherdjerred.thestorm.mechanics.domain.config.SpanConfig;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

/** The server-side material checks, against MockBukkit's block registry. */
final class MaterialsTest {

  @BeforeEach
  void start() {
    MockBukkit.mock();
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  private static MechanicsConfig shipped() {
    return ConfigFiles.load(MechanicsTestPlugin.SHIPPED_CONFIG, MechanicsConfig.class);
  }

  private static MechanicsConfig withBridgeBlocks(List<String> blocks) {
    var config = shipped();
    var bridge = config.bridge();
    return new MechanicsConfig(
        config.hiddenSwitch(),
        config.lightSwitch(),
        config.cookingPot(),
        config.blockDrops(),
        config.elevator(),
        new SpanConfig(
            new Access(true, 2, 0), blocks, bridge.maxLength(), bridge.maxWidthEachSide()),
        config.gate(),
        config.door(),
        config.signCopier(),
        config.paintingSwitcher(),
        config.pistons(),
        config.structureCooldownTicks());
  }

  @Test
  void theShippedFileNamesOnlyValidMaterials() {
    assertThat(Materials.problems(shipped())).isEmpty();
  }

  @Test
  void blocksThatHoldSeveralItemsCannotBuildStructures() {
    var problems =
        Materials.problems(
            withBridgeBlocks(
                List.of(
                    "minecraft:oak_slab",
                    "minecraft:candle",
                    "minecraft:sea_pickle",
                    "minecraft:turtle_egg",
                    "minecraft:snow",
                    "minecraft:oak_door",
                    "minecraft:oak_planks")));

    assertThat(problems)
        .containsExactly(
            "bridge.blocks: minecraft:oak_slab is not a solid block that is always exactly one item",
            "bridge.blocks: minecraft:candle is not a solid block that is always exactly one item",
            "bridge.blocks: minecraft:sea_pickle is not a solid block that is always exactly one"
                + " item",
            "bridge.blocks: minecraft:turtle_egg is not a solid block that is always exactly one"
                + " item",
            "bridge.blocks: minecraft:snow is not a solid block that is always exactly one item",
            "bridge.blocks: minecraft:oak_door is not a solid block that is always exactly one"
                + " item");
  }

  @Test
  void unknownMaterialsAreNamed() {
    assertThat(Materials.problems(withBridgeBlocks(List.of("minecraft:oak_plank"))))
        .containsExactly("bridge.blocks: minecraft:oak_plank is not a known material");
  }
}
