package com.shepherdjerred.thestorm.rwf.domain.kit;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * The ranged kits and their ammunition, and the exported {@code rwf-ranged-kits.json} that offline
 * tools ({@code bun run bots:archery}) judge archers by. The export must match the kit book: when a
 * kit changes, paste the expected text this test prints into the resource.
 */
final class RangedKitsTest {

  @Test
  void infinityBowsNeverRunOutWhileCrossbowsAndPlainBowsCarryTheirArrows() {
    var ranged = RangedKits.of(KitBook.ALL);
    assertThat(ranged)
        .contains(
            new RangedKits.Ranged("longbow", RangedKits.Weapon.BOW, RangedKits.Ammo.INFINITE, 0),
            new RangedKits.Ranged("shortbow", RangedKits.Weapon.BOW, RangedKits.Ammo.INFINITE, 0),
            new RangedKits.Ranged(
                "arbalist", RangedKits.Weapon.CROSSBOW, RangedKits.Ammo.FINITE, 48),
            new RangedKits.Ranged("volley", RangedKits.Weapon.CROSSBOW, RangedKits.Ammo.FINITE, 36),
            new RangedKits.Ranged("fletcher", RangedKits.Weapon.BOW, RangedKits.Ammo.FINITE, 32),
            new RangedKits.Ranged(
                "harpooner", RangedKits.Weapon.TRIDENT, RangedKits.Ammo.RETURNING, 0));
    assertThat(ranged).extracting(RangedKits.Ranged::kit).doesNotContain("trooper", "medic");
  }

  @Test
  void theExportedListMatchesTheKitBook() throws IOException {
    String exported;
    try (var stream = requireNonNull(getClass().getResourceAsStream("/rwf-ranged-kits.json"))) {
      exported = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
    }
    var expected = json(RangedKits.of(KitBook.ALL));
    assertThat(exported)
        .as("src/test/resources/rwf-ranged-kits.json is stale; replace it with:%n%s", expected)
        .isEqualTo(expected);
  }

  private static String json(java.util.List<RangedKits.Ranged> kits) {
    return kits.stream()
        .map(
            kit ->
                String.format(
                    Locale.ROOT,
                    "    {%n      \"id\": \"%s\",%n      \"weapon\": \"%s\",%n"
                        + "      \"ammo\": \"%s\",%n      \"arrows\": %d%n    }",
                    kit.kit(),
                    kit.weapon().name().toLowerCase(Locale.ROOT),
                    kit.ammo().name().toLowerCase(Locale.ROOT),
                    kit.arrows()))
        .collect(Collectors.joining(",\n", "{\n  \"kits\": [\n", "\n  ]\n}\n"))
        .replace("\r\n", "\n");
  }
}
