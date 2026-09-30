package com.shepherdjerred.thestorm.towns.domain.world;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_B;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlags;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.IntStream;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * Every world effect across every pairing of source and target land. Expectations are written out,
 * one row per effect.
 *
 * <p>Columns, source → target:
 *
 * <ul>
 *   <li>{@code WW}: wilderness → wilderness;
 *   <li>{@code AA}: a town-A claim → the same claim, every flag off;
 *   <li>{@code AA+}: the same, every flag on;
 *   <li>{@code A1A2}: one town-A claim → another town-A claim, every flag off on both;
 *   <li>{@code AB}: town A → town B, every flag on both (flags never open a border);
 *   <li>{@code WA}: wilderness → town A, every flag on;
 *   <li>{@code AW}: town A → wilderness;
 *   <li>{@code RR}: an admin region → itself;
 *   <li>{@code WR}: wilderness → a region;
 *   <li>{@code RW}: a region → wilderness;
 *   <li>{@code AR}: town A → a region;
 *   <li>{@code RA}: a region → town A, every flag on;
 *   <li>{@code RS}: one region → another region.
 * </ul>
 */
final class WorldRulesMatrixTest {

  private static final String MATRIX =
      """
      # effect           WW AA AA+ A1A2 AB WA AW RR WR RW AR RA RS
      PISTON             +  +  +   +    -  -  +  +  -  +  -  -  -
      FLUID_FLOW         +  +  +   +    -  -  +  +  -  +  -  -  -
      ITEM_TRANSFER      +  +  +   +    -  -  -  +  -  -  -  -  -
      DISPENSE           +  +  +   +    -  -  -  +  -  -  -  -  -
      TREE_GROWTH        +  +  +   +    -  -  +  +  -  +  -  -  -
      BONEMEAL_SPREAD    +  +  +   +    -  -  +  +  -  +  -  -  -
      SCULK_SPREAD       +  +  +   +    -  -  +  +  -  +  -  -  -
      BLOCK_SPREAD       +  +  +   +    -  -  +  +  -  +  -  -  -
      EXPLOSION          +  -  +   -    -  -  +  -  -  +  -  -  -
      FIRE_SPREAD        +  -  +   -    -  -  +  -  -  +  -  -  -
      FIRE_BURN          +  -  +   -    -  -  +  -  -  +  -  -  -
      MOB_GRIEF          +  -  +   -    -  -  +  -  -  +  -  -  -
      FALLING_BLOCK      +  +  +   +    -  -  +  +  -  +  -  -  -
      PROJECTILE_IMPACT  +  +  +   +    -  -  +  +  -  +  -  -  -
      REDSTONE           +  +  +   +    -  -  +  +  -  +  -  -  -
      PORTAL_CREATION    +  +  +   +    -  -  +  +  -  +  -  -  -
      """;

  private static final EnumSet<ClaimFlag> ALL = EnumSet.allOf(ClaimFlag.class);
  private static final Land WILD = new Land.Wilderness();
  private static final Land A1 = claim(TOWN_A, 0, EnumSet.noneOf(ClaimFlag.class));
  private static final Land A1_ALL = claim(TOWN_A, 0, ALL);
  private static final Land A2 = claim(TOWN_A, 1, EnumSet.noneOf(ClaimFlag.class));
  private static final Land B_ALL = claim(TOWN_B, 5, ALL);
  private static final Land SPAWN = new Land.RegionLand(Fixtures.region("spawn"));
  private static final Land ARENA = new Land.RegionLand(Fixtures.region("arena"));

  private static final Map<String, List<Land>> PAIRS =
      Map.ofEntries(
          Map.entry("WW", List.of(WILD, WILD)),
          Map.entry("AA", List.of(A1, A1)),
          Map.entry("AA+", List.of(A1_ALL, A1_ALL)),
          Map.entry("A1A2", List.of(A1, A2)),
          Map.entry("AB", List.of(A1_ALL, B_ALL)),
          Map.entry("WA", List.of(WILD, A1_ALL)),
          Map.entry("AW", List.of(A1_ALL, WILD)),
          Map.entry("RR", List.of(SPAWN, SPAWN)),
          Map.entry("WR", List.of(WILD, SPAWN)),
          Map.entry("RW", List.of(SPAWN, WILD)),
          Map.entry("AR", List.of(A1_ALL, SPAWN)),
          Map.entry("RA", List.of(SPAWN, A1_ALL)),
          Map.entry("RS", List.of(SPAWN, ARENA)));

  private static Land claim(java.util.UUID town, int x, EnumSet<ClaimFlag> flags) {
    return new Land.TownLand(new Claim(Fixtures.chunk(x, 0), town, new ClaimFlags(flags)));
  }

  private static List<String> header() {
    var header = MATRIX.lines().findFirst().orElseThrow().trim().split("\\s+", -1);
    return Arrays.asList(header).subList(2, header.length);
  }

  static Stream<Arguments> cells() {
    var columns = header();
    return MATRIX
        .lines()
        .skip(1)
        .filter(line -> !line.isBlank())
        .flatMap(
            line -> {
              var parts = line.trim().split("\\s+", -1);
              var effect = WorldEffect.valueOf(parts[0]);
              return IntStream.range(0, columns.size())
                  .mapToObj(i -> Arguments.of(effect, columns.get(i), parts[1 + i].equals("+")));
            });
  }

  @Test
  void theMatrixCoversEveryEffectAndPairing() {
    var effects =
        MATRIX.lines().skip(1).filter(line -> !line.isBlank()).map(l -> l.trim().split("\\s+", -1));
    assertThat(effects.map(parts -> parts[0]))
        .containsExactlyInAnyOrderElementsOf(
            Arrays.stream(WorldEffect.values()).map(Enum::name).toList());
    assertThat(header()).containsExactlyInAnyOrderElementsOf(PAIRS.keySet());
  }

  @ParameterizedTest(name = "{0} {1} -> {2}")
  @MethodSource("cells")
  void decides(WorldEffect effect, String pairing, boolean allowed) {
    var pair = Objects.requireNonNull(PAIRS.get(pairing), pairing);
    assertThat(WorldRules.allows(effect, pair.get(0), pair.get(1))).isEqualTo(allowed);
  }

  static Stream<Arguments> governed() {
    return Stream.of(
        Arguments.of(WorldEffect.EXPLOSION, ClaimFlag.EXPLOSIONS),
        Arguments.of(WorldEffect.FIRE_SPREAD, ClaimFlag.FIRE_SPREAD),
        Arguments.of(WorldEffect.FIRE_BURN, ClaimFlag.FIRE_SPREAD),
        Arguments.of(WorldEffect.MOB_GRIEF, ClaimFlag.MOB_GRIEFING));
  }

  @ParameterizedTest(name = "{0} needs exactly {1}")
  @MethodSource("governed")
  void aContainedEffectNeedsExactlyItsOwnFlag(WorldEffect effect, ClaimFlag flag) {
    var only = claim(TOWN_A, 0, EnumSet.of(flag));
    var allBut = claim(TOWN_A, 0, EnumSet.copyOf(Fixtures.allFlagsBut(flag)));

    assertThat(WorldRules.allows(effect, only, only)).isTrue();
    assertThat(WorldRules.allows(effect, allBut, allBut)).isFalse();
  }

  @Test
  void withinOneTownTheTargetClaimsFlagDecides() {
    var target = claim(TOWN_A, 1, EnumSet.of(ClaimFlag.EXPLOSIONS));

    assertThat(WorldRules.allows(WorldEffect.EXPLOSION, A1, target)).isTrue();
    assertThat(WorldRules.allows(WorldEffect.EXPLOSION, target, A1)).isFalse();
  }
}
