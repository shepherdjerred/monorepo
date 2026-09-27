package com.shepherdjerred.thestorm.towns.domain.protection;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.ASSISTANT;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OTHER_TOWN_OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * The full decision matrix: every action, for every relation a player can have to town A's land, on
 * every kind of land. Each expectation is written out below rather than derived, so a change to any
 * rule shows up as a changed line in this table.
 *
 * <p>Columns, left to right:
 *
 * <ul>
 *   <li>{@code W}: wilderness;
 *   <li>{@code A}: a claim of town A with every flag off;
 *   <li>{@code Ao}: a claim of town A with only the flag that opens this action to outsiders (see
 *       {@link OutsiderAccess}; teleports and homes have none, so every flag is on);
 *   <li>{@code Ab}: a claim of town A with every flag on except that one;
 *   <li>{@code R}: an admin region allowing nothing;
 *   <li>{@code Ra}: an admin region allowing this action on any subject.
 * </ul>
 */
final class ProtectionMatrixTest {

  private static final String MATRIX =
      """
      # action          relation   W A Ao Ab R Ra
      BUILD             OWNER      + +  +  + - +
      BUILD             ASSISTANT  + +  +  + - +
      BUILD             MEMBER     + +  +  + - +
      BUILD             OUTSIDER   + -  +  - - +
      BUILD             NOMAD      + -  +  - - +
      BUILD             BYPASS     + +  +  + + +
      BREAK             OWNER      + +  +  + - +
      BREAK             ASSISTANT  + +  +  + - +
      BREAK             MEMBER     + +  +  + - +
      BREAK             OUTSIDER   + -  +  - - +
      BREAK             NOMAD      + -  +  - - +
      BREAK             BYPASS     + +  +  + + +
      INTERACT          OWNER      + +  +  + - +
      INTERACT          ASSISTANT  + +  +  + - +
      INTERACT          MEMBER     + +  +  + - +
      INTERACT          OUTSIDER   + -  +  - - +
      INTERACT          NOMAD      + -  +  - - +
      INTERACT          BYPASS     + +  +  + + +
      OPEN_CONTAINER    OWNER      + +  +  + - +
      OPEN_CONTAINER    ASSISTANT  + +  +  + - +
      OPEN_CONTAINER    MEMBER     + +  +  + - +
      OPEN_CONTAINER    OUTSIDER   + -  +  - - +
      OPEN_CONTAINER    NOMAD      + -  +  - - +
      OPEN_CONTAINER    BYPASS     + +  +  + + +
      USE_REDSTONE      OWNER      + +  +  + - +
      USE_REDSTONE      ASSISTANT  + +  +  + - +
      USE_REDSTONE      MEMBER     + +  +  + - +
      USE_REDSTONE      OUTSIDER   + -  +  - - +
      USE_REDSTONE      NOMAD      + -  +  - - +
      USE_REDSTONE      BYPASS     + +  +  + + +
      DAMAGE_ENTITY     OWNER      + +  +  + - +
      DAMAGE_ENTITY     ASSISTANT  + +  +  + - +
      DAMAGE_ENTITY     MEMBER     + +  +  + - +
      DAMAGE_ENTITY     OUTSIDER   + -  +  - - +
      DAMAGE_ENTITY     NOMAD      + -  +  - - +
      DAMAGE_ENTITY     BYPASS     + +  +  + + +
      INTERACT_ENTITY   OWNER      + +  +  + - +
      INTERACT_ENTITY   ASSISTANT  + +  +  + - +
      INTERACT_ENTITY   MEMBER     + +  +  + - +
      INTERACT_ENTITY   OUTSIDER   + -  +  - - +
      INTERACT_ENTITY   NOMAD      + -  +  - - +
      INTERACT_ENTITY   BYPASS     + +  +  + + +
      PLACE_ENTITY      OWNER      + +  +  + - +
      PLACE_ENTITY      ASSISTANT  + +  +  + - +
      PLACE_ENTITY      MEMBER     + +  +  + - +
      PLACE_ENTITY      OUTSIDER   + -  +  - - +
      PLACE_ENTITY      NOMAD      + -  +  - - +
      PLACE_ENTITY      BYPASS     + +  +  + + +
      ATTACK_PLAYER     OWNER      + -  +  - - +
      ATTACK_PLAYER     ASSISTANT  + -  +  - - +
      ATTACK_PLAYER     MEMBER     + -  +  - - +
      ATTACK_PLAYER     OUTSIDER   + -  +  - - +
      ATTACK_PLAYER     NOMAD      + -  +  - - +
      ATTACK_PLAYER     BYPASS     + -  +  - - +
      TELEPORT_INTO     OWNER      + +  +  + - +
      TELEPORT_INTO     ASSISTANT  + +  +  + - +
      TELEPORT_INTO     MEMBER     + +  +  + - +
      TELEPORT_INTO     OUTSIDER   + -  -  - - +
      TELEPORT_INTO     NOMAD      + -  -  - - +
      TELEPORT_INTO     BYPASS     + +  +  + + +
      SET_HOME          OWNER      + +  +  + - +
      SET_HOME          ASSISTANT  + +  +  + - +
      SET_HOME          MEMBER     + +  +  + - +
      SET_HOME          OUTSIDER   + -  -  - - +
      SET_HOME          NOMAD      + -  -  - - +
      SET_HOME          BYPASS     + +  +  + + +
      """;

  private static final List<String> COLUMNS = List.of("W", "A", "Ao", "Ab", "R", "Ra");

  private final ProtectionEngine engine = new ProtectionEngine(Fixtures.trust());

  enum Relation {
    OWNER,
    ASSISTANT,
    MEMBER,
    OUTSIDER,
    NOMAD,
    BYPASS;

    Actor actor() {
      return switch (this) {
        case OWNER -> Actor.player(Fixtures.OWNER);
        case ASSISTANT -> Actor.player(Fixtures.ASSISTANT);
        case MEMBER -> Actor.player(Fixtures.MEMBER);
        case OUTSIDER -> Actor.player(OTHER_TOWN_OWNER);
        case NOMAD -> Actor.player(Fixtures.NOMAD);
        case BYPASS -> new Actor(Fixtures.NOMAD, true);
      };
    }
  }

  static Stream<Arguments> cells() {
    return MATRIX
        .lines()
        .filter(line -> !line.isBlank() && !line.startsWith("#"))
        .flatMap(
            line -> {
              var parts = line.trim().split("\\s+", -1);
              var action = Action.valueOf(parts[0]);
              var relation = Relation.valueOf(parts[1]);
              return java.util.stream.IntStream.range(0, COLUMNS.size())
                  .mapToObj(
                      column ->
                          Arguments.of(
                              action,
                              relation,
                              COLUMNS.get(column),
                              parts[2 + column].equals("+")));
            });
  }

  @Test
  void theMatrixCoversEveryActionAndRelation() {
    var rows =
        MATRIX
            .lines()
            .filter(line -> !line.isBlank() && !line.startsWith("#"))
            .map(line -> line.trim().split("\\s+", -1))
            .toList();
    assertThat(rows).allSatisfy(row -> assertThat(row).hasSize(2 + COLUMNS.size()));
    var covered = rows.stream().map(row -> row[0] + " " + row[1]).toList();
    var expected =
        Arrays.stream(Action.values())
            .flatMap(action -> Arrays.stream(Relation.values()).map(r -> action + " " + r))
            .toList();
    assertThat(covered).containsExactlyInAnyOrderElementsOf(expected);
  }

  @ParameterizedTest(name = "{0} by {1} on {2} -> {3}")
  @MethodSource("cells")
  void decides(Action action, Relation relation, String column, boolean allowed) {
    var land = landFor(column, action);
    var verdict = engine.decide(relation.actor(), new Act(action, subjectFor(action)), land);

    assertThat(verdict.isAllowed()).isEqualTo(allowed);
    if (!allowed) {
      assertThat(((Verdict.Deny) verdict).denial()).isEqualTo(expectedDenial(action, land));
    }
  }

  private static Denial expectedDenial(Action action, Land land) {
    if (action == Action.ATTACK_PLAYER) {
      return new Denial.NoPvp();
    }
    return switch (land) {
      case Land.TownLand(var claim) -> new Denial.ByTown(claim.townId(), action);
      case Land.RegionLand(var region) -> new Denial.ByRegion(region.name(), action);
      case Land.Wilderness _ -> throw new AssertionError("wilderness never denies");
    };
  }

  private static Land landFor(String column, Action action) {
    var opening = OutsiderAccess.flagFor(action);
    return switch (column) {
      case "W" -> new Land.Wilderness();
      case "A" -> Fixtures.land(TOWN_A);
      case "Ao" ->
          opening
              .map(flag -> (Land) Fixtures.land(TOWN_A, flag))
              .orElseGet(() -> Fixtures.landWithFlags(TOWN_A, EnumSet.allOf(ClaimFlag.class)));
      case "Ab" ->
          opening
              .map(flag -> (Land) Fixtures.landWithFlags(TOWN_A, Fixtures.allFlagsBut(flag)))
              .orElseGet(() -> Fixtures.landWithFlags(TOWN_A, EnumSet.allOf(ClaimFlag.class)));
      case "R" -> new Land.RegionLand(Fixtures.region("spawn"));
      case "Ra" ->
          new Land.RegionLand(Fixtures.region("spawn", Fixtures.allow(action, Subject.ANY)));
      default -> throw new IllegalArgumentException(column);
    };
  }

  static Subject subjectFor(Action action) {
    return switch (action) {
      case BUILD, BREAK, INTERACT, OPEN_CONTAINER, USE_REDSTONE -> Subject.BLOCK;
      case DAMAGE_ENTITY, INTERACT_ENTITY, PLACE_ENTITY -> Subject.ENTITY;
      case ATTACK_PLAYER -> Subject.PLAYER;
      case TELEPORT_INTO, SET_HOME -> Subject.LOCATION;
    };
  }

  @Test
  void aMemberOfTownBIsAnOutsiderOnTownALand() {
    var verdict =
        engine.decide(
            Actor.player(OTHER_TOWN_OWNER),
            new Act(Action.BUILD, Subject.BLOCK),
            Fixtures.land(TOWN_A));

    assertThat(verdict).isEqualTo(new Verdict.Deny(new Denial.ByTown(TOWN_A, Action.BUILD)));
  }

  @Test
  void everyRoleOfTownATrustsItsOwnLand() {
    for (var player : Set.of(OWNER, ASSISTANT, MEMBER)) {
      for (var action : EnumSet.complementOf(EnumSet.of(Action.ATTACK_PLAYER))) {
        assertThat(
                engine
                    .decide(
                        Actor.player(player),
                        new Act(action, subjectFor(action)),
                        Fixtures.land(TOWN_A))
                    .isAllowed())
            .as("%s %s", player, action)
            .isTrue();
      }
    }
  }

  @Test
  void aRegionAllowsOnlyTheListedSubjects() {
    var spawn =
        new Land.RegionLand(
            Fixtures.region(
                "spawn",
                Fixtures.allow(Action.INTERACT, Subject.DOOR, Subject.BUTTON),
                Fixtures.allow(Action.TELEPORT_INTO, Subject.LOCATION)));
    var nomad = Actor.player(NOMAD);

    assertThat(engine.decide(nomad, new Act(Action.INTERACT, Subject.DOOR), spawn).isAllowed())
        .isTrue();
    assertThat(engine.decide(nomad, new Act(Action.INTERACT, Subject.BUTTON), spawn).isAllowed())
        .isTrue();
    assertThat(engine.decide(nomad, new Act(Action.INTERACT, Subject.LEVER), spawn))
        .isEqualTo(new Verdict.Deny(new Denial.ByRegion("Spawn", Action.INTERACT)));
    assertThat(
            engine.decide(nomad, new Act(Action.OPEN_CONTAINER, Subject.DOOR), spawn).isAllowed())
        .isFalse();
    assertThat(
            engine
                .decide(nomad, new Act(Action.TELEPORT_INTO, Subject.LOCATION), spawn)
                .isAllowed())
        .isTrue();
    assertThat(
            engine
                .decide(nomad, new Act(Action.TELEPORT_INTO, Subject.ENDER_PEARL), spawn)
                .isAllowed())
        .isFalse();
    assertThat(engine.decide(nomad, new Act(Action.SET_HOME, Subject.LOCATION), spawn).isAllowed())
        .isFalse();
  }

  @Test
  void trustIsAskedForTheClaimsOwnTown() {
    var asked = new java.util.ArrayList<UUID>();
    var engine =
        new ProtectionEngine(
            (player, claim, act) -> {
              asked.add(claim.townId());
              return TrustLevel.OUTSIDER;
            });

    engine.decide(
        Actor.player(MEMBER), new Act(Action.BUILD, Subject.BLOCK), Fixtures.land(TOWN_A));

    assertThat(asked).containsExactly(TOWN_A);
  }

  @Test
  void bypassSkipsTheTrustLookup() {
    var engine =
        new ProtectionEngine(
            (player, claim, act) -> {
              throw new AssertionError("bypass must not consult trust");
            });

    assertThat(
            engine
                .decide(
                    new Actor(NOMAD, true),
                    new Act(Action.BREAK, Subject.BLOCK),
                    Fixtures.land(TOWN_A))
                .isAllowed())
        .isTrue();
  }
}
