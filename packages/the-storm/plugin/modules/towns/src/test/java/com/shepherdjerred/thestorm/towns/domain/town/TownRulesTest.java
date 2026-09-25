package com.shepherdjerred.thestorm.towns.domain.town;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.ASSISTANT;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.FOUNDED;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.protection.TrustLevel;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** Towns, roles, names, founding and deleting. */
final class TownRulesTest {

  private static final UUID NEW_ID = UUID.fromString("00000000-0000-4000-8000-0000000000cc");

  private final List<Town> towns = List.of(Fixtures.townA(), Fixtures.townB());

  private final TownDirectory directory =
      new TownDirectory() {
        @Override
        public Optional<Town> townOf(UUID player) {
          return towns.stream().filter(town -> town.roleOf(player).isPresent()).findFirst();
        }

        @Override
        public Optional<Town> named(String name) {
          return towns.stream()
              .filter(
                  town ->
                      town.name().toLowerCase(Locale.ROOT).equals(name.toLowerCase(Locale.ROOT)))
              .findFirst();
        }
      };

  @Test
  void rolesMapToTrustAndClaimRights() {
    assertThat(TownRole.OWNER.trust()).isEqualTo(TrustLevel.OWNER);
    assertThat(TownRole.ASSISTANT.trust()).isEqualTo(TrustLevel.TRUSTED);
    assertThat(TownRole.MEMBER.trust()).isEqualTo(TrustLevel.TRUSTED);
    assertThat(TownRole.OWNER.managesClaims()).isTrue();
    assertThat(TownRole.ASSISTANT.managesClaims()).isTrue();
    assertThat(TownRole.MEMBER.managesClaims()).isFalse();
  }

  @Test
  void aTownHasExactlyOneOwner() {
    assertThatThrownBy(() -> new Town(NEW_ID, "Nowhere", FOUNDED, Map.of(MEMBER, TownRole.MEMBER)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new Town(
                    NEW_ID,
                    "Twice",
                    FOUNDED,
                    Map.of(OWNER, TownRole.OWNER, MEMBER, TownRole.OWNER)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(Fixtures.townA().owner()).isEqualTo(OWNER);
    assertThat(Fixtures.townA().roleOf(ASSISTANT)).contains(TownRole.ASSISTANT);
    assertThat(Fixtures.townA().roleOf(NOMAD)).isEmpty();
  }

  @ParameterizedTest
  @ValueSource(strings = {"Aeg", "New_Haven_2", "abcdefghijklmnopqrst"})
  void validNames(String name) {
    assertThat(TownNames.isValid(name)).isTrue();
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "ab", "abcdefghijklmnopqrstu", "New Haven", "Tów", "a-b", "<b>x</b>"})
  void invalidNames(String name) {
    assertThat(TownNames.isValid(name)).isFalse();
  }

  @Test
  void foundingMakesTheFounderOwner() {
    var result = TownRules.found(new Founding(NOMAD, "Carthage", NEW_ID, FOUNDED), directory);

    assertThat(result).isEqualTo(Result.ok(Town.found(NEW_ID, "Carthage", FOUNDED, NOMAD)));
  }

  @Test
  void foundingReportsEveryProblem() {
    var result = TownRules.found(new Founding(MEMBER, "aEGIS", NEW_ID, FOUNDED), directory);

    assertThat(result)
        .isEqualTo(
            Result.err(
                List.of(
                    new TownProblem.AlreadyInTown("Aegis"), new TownProblem.NameTaken("aEGIS"))));
    assertThat(TownRules.found(new Founding(NOMAD, "x y", NEW_ID, FOUNDED), directory))
        .isEqualTo(Result.err(List.of(new TownProblem.InvalidName("x y"))));
  }

  @Test
  void onlyTheOwnerDeletesAndOnlyByNamingTheTown() {
    assertThat(TownRules.disband(OWNER, "aegis", directory)).isEqualTo(Result.ok(Fixtures.townA()));
    assertThat(TownRules.disband(OWNER, "", directory))
        .isEqualTo(Result.err(List.of(new TownProblem.ConfirmationMismatch("Aegis"))));
    assertThat(TownRules.disband(OWNER, "Bastion", directory))
        .isEqualTo(Result.err(List.of(new TownProblem.ConfirmationMismatch("Aegis"))));
    assertThat(TownRules.disband(ASSISTANT, "Aegis", directory))
        .isEqualTo(Result.err(List.of(new TownProblem.NotOwner(TownRole.ASSISTANT))));
    assertThat(TownRules.disband(NOMAD, "Aegis", directory))
        .isEqualTo(Result.err(List.of(new TownProblem.NotInTown())));
  }

  @Test
  void newIdsAreVersionFourAndDistinct() {
    var random = new SplittableRandom(7);
    var ids = new HashSet<UUID>();
    for (var i = 0; i < 1_000; i++) {
      var id = TownRules.newId(random);
      assertThat(id.version()).isEqualTo(4);
      assertThat(id.variant()).isEqualTo(2);
      ids.add(id);
    }
    assertThat(ids).hasSize(1_000);
  }
}
