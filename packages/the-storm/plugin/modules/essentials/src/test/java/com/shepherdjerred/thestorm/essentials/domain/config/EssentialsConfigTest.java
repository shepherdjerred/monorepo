package com.shepherdjerred.thestorm.essentials.domain.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.domain.kit.Kit;
import com.shepherdjerred.thestorm.essentials.domain.kit.KitItem;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Multiplier;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class EssentialsConfigTest {

  /** The file the server ships, relative to this module's project directory. */
  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/essentials.yml");

  static String shipped() throws IOException {
    return Files.readString(SHIPPED);
  }

  static Result<EssentialsConfig, List<Problem>> parse(String yaml) {
    return StrictYaml.parse("essentials.yml", yaml, EssentialsConfig.class);
  }

  static EssentialsConfig parsed(String yaml) {
    return parse(yaml)
        .fold(
            config -> config,
            problems -> {
              throw new AssertionError(problems);
            });
  }

  static List<Problem> problems(String yaml) {
    return parse(yaml).fold(config -> List.of(), problems -> problems);
  }

  @Test
  void theShippedFileParses() throws IOException {
    var config = parsed(shipped());

    assertThat(config.teleports().warmup()).isEqualTo(Duration.ofSeconds(3));
    assertThat(config.teleports().pricing().cap()).isEqualTo(Multiplier.of(4));
    assertThat(config.teleports().pricing().prices().of(TeleportKind.HOME).cost()).isEqualTo(25);
    assertThat(config.homeLimit()).isPositive();
    assertThat(config.kits().starter()).isEqualTo("starter");
  }

  @Test
  void theStarterKitMatchesThePlan() throws IOException {
    var starter = parsed(shipped()).kits().starterKit();

    assertThat(starter.once()).isTrue();
    assertThat(starter.items())
        .extracting(KitItem::material)
        .contains("IRON_SWORD", "STONE_PICKAXE", "STONE_AXE", "STONE_SHOVEL", "BREAD");
    assertThat(starter.books())
        .singleElement()
        .satisfies(book -> assertThat(book.title()).isEqualTo("Welcome to The Storm"));
  }

  @Test
  void theRulesCoverTheOldRulesAndDiscloseTheAi() throws IOException {
    var text = String.join("\n", parsed(shipped()).rules().pages()).toLowerCase(Locale.ROOT);

    assertThat(text)
        .contains("griefing", "raiding", "100 blocks", "hack", "death pile", "bug", "war chat")
        .contains("respect", "spam", "advertising", "ai provider");
  }

  @Test
  void unknownKeysAreRejected() throws IOException {
    var yaml = shipped() + "\nsurprise: true\n";

    assertThat(problems(yaml))
        .singleElement()
        .satisfies(p -> assertThat(p.message()).contains("surprise"));
  }

  @Test
  void missingKeysAreRejected() throws IOException {
    var yaml = shipped().replace("homeLimit: 3\n", "");

    assertThat(problems(yaml))
        .singleElement()
        .satisfies(p -> assertThat(p.message()).contains("homeLimit"));
  }

  @Test
  void invariantsAreCheckedWithTheirPath() throws IOException {
    var yaml = shipped().replace("backHistorySize: 5", "backHistorySize: 0");

    assertThat(problems(yaml))
        .singleElement()
        .satisfies(p -> assertThat(p.path()).isEqualTo("teleports"));
  }

  @Test
  void theStarterKitMustExist() {
    var kit =
        new Kit(
            List.of(new KitItem("BREAD", 1, Optional.empty(), Map.of())),
            List.of(),
            Duration.ZERO,
            true);

    assertThatThrownBy(() -> new KitSettings("missing", Map.of("starter", kit)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new KitSettings("Starter", Map.of("Starter", kit)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(new KitSettings("starter", Map.of("starter", kit)).starterKit()).isEqualTo(kit);
  }

  @Test
  void limitsAreBounded() throws IOException {
    assertThat(problems(shipped().replace("homeLimit: 3", "homeLimit: 0"))).hasSize(1);
    assertThat(problems(shipped().replace("afkTimeout: PT5M", "afkTimeout: PT0S"))).hasSize(1);
    assertThat(problems(shipped().replace("tpaTimeout: PT1M", "tpaTimeout: PT0S"))).hasSize(1);
    assertThat(problems(shipped().replace("warmup: PT3S", "warmup: PT-1S"))).hasSize(1);
  }
}
