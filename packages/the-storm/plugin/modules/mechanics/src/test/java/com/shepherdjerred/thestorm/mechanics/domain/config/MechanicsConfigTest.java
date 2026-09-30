package com.shepherdjerred.thestorm.mechanics.domain.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.TestConfigs;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class MechanicsConfigTest {

  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/mechanics.yml");

  static MechanicsConfig shipped() throws IOException {
    var parsed =
        StrictYaml.parse("mechanics.yml", Files.readString(SHIPPED), MechanicsConfig.class);
    assertThat(parsed).isInstanceOf(Result.Ok.class);
    return ((Result.Ok<MechanicsConfig, List<Problem>>) parsed).value();
  }

  @Test
  void theShippedFileParses() throws IOException {
    var config = shipped();

    assertThat(config.bridge().maxLength()).isEqualTo(32);
    assertThat(config.door().blocks()).isEqualTo(config.bridge().blocks());
    assertThat(config.cookingPot().fuels()).containsEntry("minecraft:coal", 8);
    assertThat(config.signCopier().tool()).isEqualTo("minecraft:feather");
    assertThat(config.structureCooldownTicks()).isEqualTo(20);
    assertThat(config.bridge().blocks()).noneMatch(block -> block.endsWith("_slab"));
  }

  @Test
  void theShippedLevelsFollowTheTrack() throws IOException {
    var config = shipped();

    assertThat(config.access(Feature.HIDDEN_SWITCH).level()).isEqualTo(1);
    assertThat(config.access(Feature.LIGHT_SWITCH).level()).isEqualTo(1);
    assertThat(config.access(Feature.COOKING_POT).level()).isEqualTo(1);
    assertThat(config.access(Feature.BLOCK_DROPS).level()).isEqualTo(1);
    assertThat(config.access(Feature.ELEVATOR).level()).isEqualTo(2);
    assertThat(config.access(Feature.BRIDGE).level()).isEqualTo(2);
    assertThat(config.access(Feature.GATE).level()).isEqualTo(2);
    assertThat(config.access(Feature.DOOR).level()).isEqualTo(2);
    assertThat(config.access(Feature.SIGN_COPIER).level()).isEqualTo(3);
    assertThat(config.access(Feature.PAINTING_SWITCHER).level()).isEqualTo(3);
    assertThat(config.access(Feature.CRUSH).level()).isEqualTo(4);
    assertThat(config.access(Feature.BOUNCE).level()).isEqualTo(4);
    assertThat(config.access(Feature.SUPER_STICKY).level()).isEqualTo(5);
    assertThat(config.access(Feature.SUPER_PUSH).level()).isEqualTo(5);
    for (var feature : Feature.values()) {
      assertThat(config.access(feature).enabled()).as(feature.name()).isTrue();
    }
  }

  @Test
  void structuresWaitAtLeastASecond() {
    var valid = TestConfigs.mechanics();

    assertThatThrownBy(
            () ->
                new MechanicsConfig(
                    valid.hiddenSwitch(),
                    valid.lightSwitch(),
                    valid.cookingPot(),
                    valid.blockDrops(),
                    valid.elevator(),
                    valid.bridge(),
                    valid.gate(),
                    valid.door(),
                    valid.signCopier(),
                    valid.paintingSwitcher(),
                    valid.pistons(),
                    19))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void levelsStayOnTheTrack() {
    assertThatThrownBy(() -> new Access(true, 0, 0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Access(true, 6, 0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Access(true, 2, 3)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Unlock(true, 0)).isInstanceOf(IllegalArgumentException.class);
    assertThat(new Access(true, 3, 0).useLevel()).isZero();
    assertThat(new Unlock(false, 4).asAccess()).isEqualTo(new Access(false, 4, 4));
  }

  @Test
  void sizesAreBounded() {
    var access = new Access(true, 2, 2);
    var planks = List.of("minecraft:oak_planks");
    assertThatThrownBy(() -> new SpanConfig(access, planks, 0, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new SpanConfig(access, planks, SpanConfig.MAX_LENGTH + 1, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new SpanConfig(access, planks, 8, SpanConfig.MAX_WIDTH_EACH_SIDE + 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new GateConfig(access, planks, 0, 4, 4))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new ElevatorConfig(access, 1))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void materialListsMustBeWellFormedDistinctAndNonEmpty() {
    var access = new Access(true, 2, 2);
    assertThatThrownBy(() -> new SpanConfig(access, List.of(), 8, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new SpanConfig(access, List.of("Oak Planks"), 8, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () -> new SpanConfig(access, List.of("minecraft:stone", "minecraft:stone"), 8, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new SignCopierConfig(new Unlock(true, 3), "feather"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aCookingPotNeedsFuelThatIsWorthSomething() {
    var access = new Access(true, 1, 1);
    var fire = List.of("minecraft:fire");
    assertThatThrownBy(() -> new CookingPotConfig(access, fire, Map.of(), 64))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new CookingPotConfig(access, fire, Map.of("minecraft:coal", 0), 64))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new CookingPotConfig(access, fire, Map.of("coal", 8), 64))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void unknownOrMissingKeysAreRejected() {
    var missing =
        StrictYaml.parse(
            "mechanics.yml",
            "hiddenSwitch: { access: { enabled: true, level: 1, useLevel: 1 } }",
            MechanicsConfig.class);
    var unknown =
        StrictYaml.parse(
            "hidden.yml",
            "access: { enabled: true, level: 1, useLevel: 1 }\nextra: 3",
            HiddenSwitchConfig.class);

    assertThat(missing).isInstanceOf(Result.Err.class);
    assertThat(unknown).isInstanceOf(Result.Err.class);
  }
}
