package com.shepherdjerred.thestorm.mobs.domain.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mobs.domain.scaling.Stat;
import com.shepherdjerred.thestorm.mobs.domain.spawn.AdminPolicy;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class MobsConfigTest {

  /** The file the server ships, relative to this module's project directory. */
  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/mobs.yml");

  static String shipped() throws IOException {
    return Files.readString(SHIPPED);
  }

  static Result<MobsConfig, List<Problem>> parse(String yaml) {
    return StrictYaml.parse("mobs.yml", yaml, MobsConfig.class);
  }

  static List<Problem> problems(String yaml) {
    return parse(yaml).fold(config -> List.of(), problems -> problems);
  }

  static MobsConfig parsed(String yaml) {
    return parse(yaml)
        .fold(
            config -> config,
            problems -> {
              throw new AssertionError(problems);
            });
  }

  @Test
  void theShippedFileParsesWithThe2023Balance() throws IOException {
    var config = parsed(shipped());

    assertThat(config.levels().cap()).isEqualTo(50);
    assertThat(config.levels().depth().multiplier()).isEqualTo(0.05);
    assertThat(config.levels().depth().period()).isEqualTo(5);
    assertThat(config.levels().depth().transitionY()).isEqualTo(62);
    assertThat(config.levels().world("world")).isPresent();
    assertThat(config.levels().world("world_the_end")).isEmpty();
    assertThat(config.scaling().atCap(Stat.MAX_HEALTH, "zombie")).isEqualTo(1.1);
    assertThat(config.scaling().atCap(Stat.ATTACK_DAMAGE, "zombie")).isEqualTo(1.1);
    assertThat(config.scaling().atCap(Stat.MAX_HEALTH, "enderman")).isZero();
    assertThat(config.exclusions().levelledReasons())
        .containsExactlyInAnyOrder("NATURAL", "JOCKEY", "MOUNT", "PATROL");
    assertThat(config.scaling().atCap(Stat.XP, "zombie")).isEqualTo(1.0);
    assertThat(config.scaling().atCap(Stat.ITEM_DROPS, "zombie")).isEqualTo(0.5);
    assertThat(config.levels().world("world_nether"))
        .hasValueSatisfying(nether -> assertThat(nether.distanceScale()).isEqualTo(4.0));
    assertThat(config.adminRegions().policy()).isEqualTo(AdminPolicy.BLOCK_NATURAL);
    assertThat(config.nameplate().enabled()).isTrue();
  }

  @Test
  void unknownKeysAndBadValuesAreRejected() throws IOException {
    assertThat(problems(shipped() + "\nextra: true\n")).isNotEmpty();
    assertThat(problems(shipped().replace("cap: 50", "cap: 1")))
        .anySatisfy(problem -> assertThat(problem.toString()).contains("cap"));
    assertThat(problems(shipped().replace("    MAX_HEALTH: 1.1\n", "")))
        .anySatisfy(problem -> assertThat(problem.toString()).contains("MAX_HEALTH"));
    assertThat(problems(shipped().replace("policy: BLOCK_NATURAL", "policy: SOMETIMES")))
        .isNotEmpty();
    assertThat(problems(shipped().replace("\"#22E76B\"", "green"))).isNotEmpty();
    assertThat(problems(shipped().replace("{ from: 30, color", "{ from: 60, color")))
        .anySatisfy(problem -> assertThat(problem.toString()).contains("above the level cap"));
  }

  static final Nameplate PLATE =
      new Nameplate(
          true,
          false,
          List.of(
              new Nameplate.ColorBand(1, "#22E76B"),
              new Nameplate.ColorBand(10, "#FFCD56"),
              new Nameplate.ColorBand(30, "#F2003D")));

  @ParameterizedTest
  @CsvSource({
    "1, #22E76B",
    "9, #22E76B",
    "10, #FFCD56",
    "29, #FFCD56",
    "30, #F2003D",
    "50, #F2003D"
  })
  void nameplateColorsChangeAtEachBandsFirstLevel(int level, String color) {
    assertThat(PLATE.colorFor(level)).isEqualTo(color);
  }

  @Test
  void nameplateBandsMustStartAtOneAndGrow() {
    assertThatThrownBy(() -> new Nameplate(true, false, List.of())).hasMessageContaining("level 1");
    assertThatThrownBy(
            () -> new Nameplate(true, false, List.of(new Nameplate.ColorBand(2, "#FFFFFF"))))
        .hasMessageContaining("level 1");
    assertThatThrownBy(
            () ->
                new Nameplate(
                    true,
                    false,
                    List.of(
                        new Nameplate.ColorBand(1, "#FFFFFF"),
                        new Nameplate.ColorBand(1, "#000000"))))
        .hasMessageContaining("ordered");
    assertThatThrownBy(() -> new Nameplate.ColorBand(0, "#FFFFFF")).hasMessageContaining("level");
    assertThatThrownBy(() -> new Nameplate.ColorBand(1, "#FFF")).hasMessageContaining("#RRGGBB");
  }

  @Test
  void anchorsNeedAWorld() {
    assertThatThrownBy(() -> new AdminRegions.Anchor(" ", 0, 0, 0)).hasMessageContaining("world");
  }
}
