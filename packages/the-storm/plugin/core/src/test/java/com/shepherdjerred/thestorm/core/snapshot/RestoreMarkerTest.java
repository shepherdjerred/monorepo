package com.shepherdjerred.thestorm.core.snapshot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class RestoreMarkerTest {

  private static Snapshot snapshot(Vitals vitals) {
    return new Snapshot(
        UUID.fromString("00000000-0000-0000-0000-000000000001"),
        "rwf",
        new Position("world", 1.5, 64, -2.5, 90, 10),
        vitals,
        new Experience(12, 0.25f, 300),
        ItemData.of(new byte[] {1, 2, 3}),
        List.of(),
        Instant.parse("2026-09-25T12:00:00Z"));
  }

  @Test
  void historicalFingerprintRemainsByteForByteCompatible() {
    // Computed from the original five-component Vitals record, before this migration.
    assertThat(
            RestoreMarker.fingerprint(
                snapshot(new Vitals(new Vitals.Condition(17.5, 18, 2.5f, 0.5f), "SURVIVAL"))))
        .isEqualTo("31ebc109f6fad65f0159bd4f1210bc0a0d7b92c404b2c34bba4fb6343d72851b");
  }

  @Test
  void currentFingerprintBindsFlightSpeedAndImmunityAndCannotMatchLegacyProof() {
    var legacy =
        RestoreMarker.fingerprint(
            snapshot(new Vitals(new Vitals.Condition(17.5, 18, 2.5f, 0.5f), "SURVIVAL")));
    var current =
        new Vitals(
            new Vitals.Condition(17.5, 18, 2.5f, 0.5f),
            "SURVIVAL",
            new Vitals.Flight(true, true, 0.3f),
            7);
    var fingerprint = RestoreMarker.fingerprint(snapshot(current));
    assertThat(fingerprint).isNotEqualTo(legacy);
    assertThat(
            RestoreMarker.fingerprint(
                snapshot(
                    new Vitals(
                        new Vitals.Condition(17.5, 18, 2.5f, 0.5f),
                        "SURVIVAL",
                        new Vitals.Flight(true, false, 0.3f),
                        7))))
        .isNotEqualTo(fingerprint);
    assertThat(
            RestoreMarker.fingerprint(
                snapshot(
                    new Vitals(
                        new Vitals.Condition(17.5, 18, 2.5f, 0.5f),
                        "SURVIVAL",
                        new Vitals.Flight(true, true, 0.2f),
                        7))))
        .isNotEqualTo(fingerprint);
    assertThat(
            RestoreMarker.fingerprint(
                snapshot(
                    new Vitals(
                        new Vitals.Condition(17.5, 18, 2.5f, 0.5f),
                        "SURVIVAL",
                        new Vitals.Flight(true, true, 0.3f),
                        20))))
        .isNotEqualTo(fingerprint);
  }

  @Test
  void invalidVersionAndImpossibleFlightFailLoudly() {
    assertThatThrownBy(
            () ->
                new Vitals(
                    new Vitals.Condition(20, 20, 0, 0),
                    "SURVIVAL",
                    new Vitals.Flight(false, true, 0.1f),
                    20))
        .hasMessageContaining("flying");
    assertThatThrownBy(
            () ->
                new Vitals(
                    new Vitals.Condition(20, 20, 0, 0),
                    "SURVIVAL",
                    new Vitals.Flight(false, false, Float.NaN),
                    20))
        .hasMessageContaining("flySpeed");
    assertThatThrownBy(
            () ->
                new Vitals(
                    new Vitals.Condition(20, 20, 0, 0),
                    "SURVIVAL",
                    new Vitals.Flight(false, false, 0.1f),
                    -1))
        .hasMessageContaining("maximumNoDamageTicks");
    assertThatThrownBy(
            () ->
                new Vitals(
                    new Vitals.Condition(20, 20, 0, 0),
                    "SURVIVAL",
                    new Vitals.Flight(false, false, 0.1f),
                    20,
                    3))
        .hasMessageContaining("version");
    assertThatThrownBy(
            () ->
                new Vitals(
                    new Vitals.Condition(20, 20, 0, 0),
                    "SURVIVAL",
                    new Vitals.Flight(true, true, 0.1f),
                    20,
                    1))
        .hasMessageContaining("historical");
  }
}
