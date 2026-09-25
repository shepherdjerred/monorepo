package com.shepherdjerred.thestorm.spells.domain.config;

import static java.util.stream.Collectors.groupingBy;
import static java.util.stream.Collectors.toUnmodifiableSet;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class SpellsConfigTest {

  private static String shipped = "";

  @BeforeAll
  static void read() throws IOException {
    shipped =
        Files.readString(
            Path.of(Objects.requireNonNull(System.getProperty("thestorm.spells.config"))));
  }

  private static SpellsConfig parse(String yaml) {
    return StrictYaml.parse("spells.yml", yaml, SpellsConfig.class)
        .fold(
            config -> config,
            problems -> {
              throw new AssertionError(problems.toString());
            });
  }

  private static boolean rejects(String yaml) {
    return !StrictYaml.parse("spells.yml", yaml, SpellsConfig.class).isOk();
  }

  @Test
  void theShippedConfigParsesWithEverySpell() {
    var config = parse(shipped);

    assertThat(config.spells().all()).containsOnlyKeys(SpellKind.values());
    assertThat(config.spells().all().values()).allMatch(SpellEntry::enabled);
    assertThat(config.label()).isEqualTo("Spells");
  }

  @Test
  void theShippedSpellsSpanEveryTier() {
    var byTier =
        parse(shipped).spells().all().entrySet().stream()
            .collect(groupingBy(entry -> entry.getValue().tier(), toUnmodifiableSet()));

    assertThat(byTier).containsOnlyKeys(1, 2, 3, 4, 5);
  }

  @Test
  void onlyTheQuestSpellsNeedLearning() {
    var learned =
        parse(shipped).spells().all().entrySet().stream()
            .filter(entry -> entry.getValue().learned())
            .map(Map.Entry::getKey)
            .toList();

    assertThat(learned)
        .containsExactlyInAnyOrder(SpellKind.CLEANSE, SpellKind.BLINK, SpellKind.CARPET);
  }

  @Test
  void dawnAndDuskShareOneCooldownAndEveryOtherSpellHasItsOwn() {
    var groups =
        parse(shipped).spells().all().entrySet().stream()
            .collect(groupingBy(entry -> entry.getValue().cooldownGroup(), toUnmodifiableSet()));

    groups.forEach(
        (group, members) -> {
          if (group.equals("sky")) {
            assertThat(members)
                .extracting(Map.Entry::getKey)
                .containsExactlyInAnyOrder(SpellKind.DAWN, SpellKind.DUSK);
          } else {
            assertThat(members).hasSize(1);
          }
        });
  }

  @Test
  void everyFocusCastCostsReagents() {
    assertThat(parse(shipped).spells().all().values())
        .allSatisfy(entry -> assertThat(entry.reagents()).isNotEmpty());
  }

  @Test
  void entriesExposeTheirGateTerms() {
    var wall = parse(shipped).spells().wall();
    var terms = wall.terms();

    assertThat(terms.tier()).isEqualTo(wall.tier());
    assertThat(terms.cost().amounts()).isEqualTo(wall.reagents());
    assertThat(terms.cooldown()).hasSeconds(wall.cooldownSeconds());
    assertThat(terms.cooldownGroup()).isEqualTo("wall");
  }

  @ParameterizedTest
  @CsvSource(
      delimiter = '|',
      value = {
        "tier: 1|tier: 6",
        "tier: 1|tier: 0",
        "cooldownGroup: mark|cooldownGroup: Mark!",
        "cooldownSeconds: 60|cooldownSeconds: 0",
        "REDSTONE: 15, LAPIS_LAZULI: 15|redstone: 15, LAPIS_LAZULI: 15",
        "REDSTONE: 15, LAPIS_LAZULI: 15|REDSTONE: 0, LAPIS_LAZULI: 15",
        "particle: PORTAL|particle: portal",
        "sound: block.respawn_anchor.set_spawn|sound: Block Anchor",
        "model: minecraft:compass|model: compass",
        "size: 3|size: 4",
        "width: 5|width: 50",
        "targetTime: 0|targetTime: 24000",
        "label: Spells|label: ' '",
        "maxStack: 16|maxStack: 0",
        "settings: { searchRadius: 3 }|settings: { searchRadius: 3, extra: 1 }",
        "settings: { searchRadius: 3 }|settings: {}",
        "immuneEntities: [ENDER_DRAGON, WITHER, WARDEN, ELDER_GUARDIAN]|immuneEntities: [ender_dragon]",
      })
  void badValuesAreRejected(String good, String bad) {
    var broken = shipped.replaceFirst(Pattern.quote(good), Matcher.quoteReplacement(bad));

    assertThat(broken).isNotEqualTo(shipped);
    assertThat(rejects(broken)).isTrue();
  }

  @Test
  void aMissingSpellIsRejected() {
    var withoutMark = shipped.replaceFirst("\n  mark:\n", "\n  unmarked:\n");

    assertThat(rejects(withoutMark)).isTrue();
  }
}
