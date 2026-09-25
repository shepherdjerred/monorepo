package com.shepherdjerred.thestorm.tracks.domain;

import static com.shepherdjerred.thestorm.tracks.domain.Progressions.DEFAULT_PRICING;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.tracks.app.Track;
import java.nio.file.Path;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

final class TracksConfigTest {

  /** The file the server actually ships, relative to this module's project directory. */
  public static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/tracks.yml");

  private static final String LEVELS =
      """
          levels:
            - {title: One, unlocks: [a]}
            - {title: Two, unlocks: [b]}
            - {title: Three, unlocks: [c]}
            - {title: Four, unlocks: [d]}
            - {title: Five, unlocks: [e, f]}
      """;

  private static String track(String id) {
    return "  "
        + id
        + ":\n    displayName: "
        + id
        + "\n    color: \"#112233\"\n    summary: About "
        + id
        + "\n"
        + LEVELS;
  }

  private static final String VALID =
      """
      pricing:
        baseCosts: [1000, 2500, 5000, 10000, 20000]
        orderMultipliers: [1, 1.5, 2, 3, 4]
      purchaseCooldownMinutes: 1440
      confirmSeconds: 30
      tracks:
      """
          + track("shopkeeper")
          + track("mechanic")
          + track("engineer")
          + track("spellcaster")
          + track("governor");

  private static boolean parses(String yaml) {
    return StrictYaml.parse("tracks.yml", yaml, TracksConfig.class).isOk();
  }

  @Test
  void theShippedFileParsesWithThePlannedNumbers() {
    var config = ConfigFiles.load(SHIPPED, TracksConfig.class);

    assertThat(config.pricing()).isEqualTo(DEFAULT_PRICING);
    assertThat(config.purchaseCooldown()).isEqualTo(Duration.ofHours(24));
    assertThat(config.confirmWindow()).isEqualTo(Duration.ofSeconds(30));
    assertThat(config.info(Track.GOVERNOR).level(1).unlocks()).contains("Found a town.");
  }

  @ParameterizedTest
  @EnumSource(Track.class)
  void theShippedFileDescribesEveryLevelOfEveryTrack(Track track) {
    var info = ConfigFiles.load(SHIPPED, TracksConfig.class).info(track);

    assertThat(info.levels()).hasSize(Track.MAX_LEVEL);
    assertThat(info.displayName()).isNotBlank();
  }

  @Test
  void aValidDocumentParses() {
    assertThat(parses(VALID)).isTrue();
  }

  @Test
  void theCooldownMayBeDisabled() {
    var config =
        StrictYaml.parse(
                "tracks.yml",
                VALID.replace("purchaseCooldownMinutes: 1440", "purchaseCooldownMinutes: 0"),
                TracksConfig.class)
            .fold(value -> value.purchaseCooldown(), problems -> Duration.ofDays(-1));

    assertThat(config).isZero();
  }

  @Test
  void unknownKeysAreRejected() {
    assertThat(parses(VALID + "refunds: true\n")).isFalse();
  }

  @Test
  void missingKeysAreRejected() {
    assertThat(parses(VALID.replace("confirmSeconds: 30\n", ""))).isFalse();
    assertThat(parses(VALID.replace("  orderMultipliers: [1, 1.5, 2, 3, 4]\n", ""))).isFalse();
  }

  @Test
  void aNegativeCooldownIsRejected() {
    assertThat(
            parses(VALID.replace("purchaseCooldownMinutes: 1440", "purchaseCooldownMinutes: -1")))
        .isFalse();
  }

  @Test
  void theConfirmWindowIsBounded() {
    assertThat(parses(VALID.replace("confirmSeconds: 30", "confirmSeconds: 0"))).isFalse();
    assertThat(parses(VALID.replace("confirmSeconds: 30", "confirmSeconds: 301"))).isFalse();
  }

  @Test
  void everyTrackMustBeListed() {
    assertThat(parses(VALID.replace(track("governor"), ""))).isFalse();
  }

  @Test
  void unknownTracksAreRejected() {
    assertThat(parses(VALID + track("wizard"))).isFalse();
  }

  @Test
  void aTrackNeedsFiveLevels() {
    assertThat(parses(VALID.replace("      - {title: Five, unlocks: [e, f]}\n", ""))).isFalse();
  }

  @Test
  void aLevelNeedsUnlocks() {
    assertThat(parses(VALID.replace("unlocks: [e, f]", "unlocks: []"))).isFalse();
    assertThat(parses(VALID.replace("unlocks: [e, f]", "unlocks: [e, \" \"]"))).isFalse();
  }

  @Test
  void colorsMustBeHex() {
    assertThat(parses(VALID.replace("\"#112233\"", "gold"))).isFalse();
    assertThat(parses(VALID.replace("\"#112233\"", "\"#12345\""))).isFalse();
  }

  @Test
  void pricesAreValidated() {
    assertThat(parses(VALID.replace("[1000, 2500, 5000, 10000, 20000]", "[1000, 2500]"))).isFalse();
    assertThat(parses(VALID.replace("[1, 1.5, 2, 3, 4]", "[0.5, 1.5, 2, 3, 4]"))).isFalse();
  }

  @Test
  void colorsConvertToRgb() {
    var info = ConfigFiles.load(SHIPPED, TracksConfig.class).info(Track.SHOPKEEPER);

    assertThat(info.rgb()).isEqualTo(0xE0B040);
  }
}
