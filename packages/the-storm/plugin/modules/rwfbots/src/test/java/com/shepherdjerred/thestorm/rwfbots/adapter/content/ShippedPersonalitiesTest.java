package com.shepherdjerred.thestorm.rwfbots.adapter.content;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.rwfbots.app.Director;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.PersonalityCatalog;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * The personalities the server ships load as a catalog, cover the whole skill range and can all be
 * drafted with the kits the shipped config offers.
 */
final class ShippedPersonalitiesTest {

  private static final int BANDS = 5;

  private static PersonalityCatalog catalog;

  private static Path shipped() {
    var path = System.getProperty("thestorm.rwfbots.personalities");
    assertThat(path).as("the build passes the shipped personalities directory").isNotNull();
    return Path.of(path);
  }

  @BeforeAll
  static void load() {
    catalog = PersonalityFiles.loadDirectory(shipped());
  }

  @Test
  void theFirstBatchShipsTwentyActivePersonalities() {
    assertThat(catalog.all()).hasSize(20);
    assertThat(catalog.active()).hasSize(20);
    assertThat(catalog.all()).allMatch(personality -> personality.batch() == 1);
  }

  @Test
  void aFullLobbyDraftsEveryShippedPersonalityWithAShippedKit() {
    var config = System.getProperty("thestorm.rwfbots.config");
    assertThat(config).as("the build passes the shipped config").isNotNull();
    var kits = ConfigFiles.load(Path.of(config), RwfBotsConfig.class).draft().availableKits();
    var request =
        new Director.Request(
            catalog, Map.of(), List.of(), catalog.active().size(), Set.of(), kits, 2);

    var pick = Director.pick(request, new SplittableRandom(1));

    assertThat(pick.bots()).hasSize(20);
    assertThat(pick.bots()).extracting(Director.Drafted::kit).allMatch(kits::contains);
  }

  @Test
  void skillIsSpreadAcrossAllFiveBands() {
    var perBand = new int[BANDS];
    for (var personality : catalog.all()) {
      perBand[Math.min(BANDS - 1, (int) Math.floor(personality.skill() * BANDS))]++;
    }

    assertThat(perBand).hasSize(BANDS);
    for (var band = 0; band < BANDS; band++) {
      assertThat(perBand[band]).as("band %d", band).isGreaterThanOrEqualTo(2);
    }
  }

  @Test
  void everyPersonalityHasABioAndSomethingToSay() {
    for (var personality : catalog.all()) {
      assertThat(personality.bio()).as(personality.id()).isNotBlank();
      assertThat(personality.chat().toneTags()).as(personality.id()).isNotEmpty();
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
  void everyPersonalityPrefersAtLeastOneKitAndRole() {
    assertThat(catalog.all())
        .allSatisfy(
            (Personality personality) -> {
              assertThat(personality.kits()).isNotEmpty();
              assertThat(personality.roles()).isNotEmpty();
            });
  }
}
