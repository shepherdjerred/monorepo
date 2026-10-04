package com.shepherdjerred.thestorm.rwfbots.adapter.content;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.rwfbots.app.Director;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.PersonalityCatalog;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.nio.file.Path;
import java.util.Base64;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * The personalities the server ships load as a catalog, spread every archetype across the whole
 * skill range, read as distinct characters and can all be drafted with the kits the shipped config
 * offers.
 */
final class ShippedPersonalitiesTest {

  private static final int BANDS = 5;
  private static final int FIRST_BATCH = 20;

  /** A kit weight at or above this is a real preference, not a token entry. */
  private static final double MEANINGFUL_WEIGHT = 0.5;

  private static PersonalityCatalog catalog;
  private static Set<Kit> shippedKits;

  private static Path property(String key, String what) {
    var path = System.getProperty(key);
    assertThat(path).as("the build passes the shipped %s", what).isNotNull();
    return Path.of(path);
  }

  @BeforeAll
  static void load() {
    catalog =
        PersonalityFiles.loadDirectory(
            property("thestorm.rwfbots.personalities", "personalities directory"));
    shippedKits =
        ConfigFiles.load(property("thestorm.rwfbots.config", "config"), RwfBotsConfig.class)
            .draft()
            .availableKits();
  }

  private static int band(Personality personality) {
    return Math.min(BANDS - 1, (int) Math.floor(personality.skill() * BANDS));
  }

  @Test
  void theFirstBatchShipsTwentyActivePersonalities() {
    assertThat(catalog.all()).hasSize(FIRST_BATCH);
    assertThat(catalog.active()).hasSameSizeAs(catalog.all());
    assertThat(catalog.all().stream().filter(p -> p.batch() == 1)).hasSize(FIRST_BATCH);
  }

  @Test
  void aFullLobbyDraftsEveryShippedPersonalityWithAShippedKit() {
    var request =
        new Director.Request(
            catalog, Map.of(), List.of(), catalog.active().size(), Set.of(), shippedKits, 2);

    var pick = Director.pick(request, new SplittableRandom(1));

    assertThat(pick.bots()).hasSameSizeAs(catalog.active());
    assertThat(pick.bots()).extracting(Director.Drafted::kit).allMatch(shippedKits::contains);
  }

  @Test
  void everyArchetypeIsRepresentedRoughlyEvenly() {
    var perArchetype = new EnumMap<Archetype, Integer>(Archetype.class);
    catalog.all().forEach(p -> perArchetype.merge(p.archetype(), 1, Integer::sum));

    assertThat(perArchetype).containsOnlyKeys(Archetype.values());
    var even = catalog.all().size() / Archetype.values().length;
    assertThat(perArchetype.values()).allSatisfy(n -> assertThat(n).isBetween(even - 2, even + 2));
  }

  @Test
  void skillIsSpreadAcrossAllFiveBands() {
    var perBand = new int[BANDS];
    catalog.all().forEach(p -> perBand[band(p)]++);
    for (var band = 0; band < BANDS; band++) {
      assertThat(perBand[band]).as("band %d", band).isGreaterThanOrEqualTo(2);
    }
  }

  @Test
  void everyLineFitsChatAndUsesOnlyItsMomentsPlaceholders() {
    for (var personality : catalog.all()) {
      for (var moment : Lines.Moment.values()) {
        var pool = personality.lines().pool(moment);
        assertThat(pool).as("%s %s", personality.id(), moment).hasSizeBetween(2, 6);
        for (var line : pool) {
          assertThat(line).as(personality.id()).hasSizeLessThanOrEqualTo(Lines.MAX_LINE_LENGTH);
          assertThat(moment.placeholders())
              .as("%s %s: %s", personality.id(), moment, line)
              .containsAll(Lines.placeholdersOf(line));
        }
      }
    }
  }

  @Test
  void everyPersonalityIsItsOwnCharacter() {
    var bios = new HashSet<String>();
    var styles = new HashSet<String>();
    var greetings = new HashSet<List<String>>();
    for (var personality : catalog.all()) {
      assertThat(bios.add(personality.bio())).as("%s bio is unique", personality.id()).isTrue();
      assertThat(styles.add(personality.voice().style()))
          .as("%s voice style is unique", personality.id())
          .isTrue();
      assertThat(greetings.add(personality.lines().greet()))
          .as("%s greetings are its own", personality.id())
          .isTrue();
      assertThat(personality.quirks()).as(personality.id()).hasSizeBetween(1, 3);
    }
  }

  @Test
  void rivalriesNameOtherShippedPersonalities() {
    var withRivals = catalog.all().stream().filter(p -> !p.rivals().isEmpty()).count();
    assertThat(withRivals).as("most personalities have a rival").isGreaterThan(10);
    for (var personality : catalog.all()) {
      for (var rival : personality.rivals()) {
        assertThat(catalog.byId(rival)).as("%s rival %s", personality.id(), rival).isPresent();
        assertThat(rival).isNotEqualTo(personality.id());
      }
    }
  }

  @Test
  void everySkinIsASignedMojangTexture() {
    for (var personality : catalog.all()) {
      var decoded = new String(Base64.getDecoder().decode(personality.skinValue()), UTF_8);
      assertThat(decoded)
          .as(personality.id())
          .contains("\"textures\"")
          .contains("http://textures.minecraft.net/texture/");
      assertThat(Base64.getDecoder().decode(personality.skinSignature()))
          .as("%s signature is base64", personality.id())
          .isNotEmpty();
    }
  }

  @Test
  void everyPersonalityLeansOnAShippedKitAndPrefersARole() {
    assertThat(catalog.all())
        .allSatisfy(
            (Personality personality) -> {
              assertThat(personality.kits().entrySet())
                  .as(personality.id())
                  .anyMatch(
                      kit ->
                          shippedKits.contains(kit.getKey())
                              && kit.getValue() >= MEANINGFUL_WEIGHT);
              assertThat(personality.roles()).isNotEmpty();
            });
  }
}
