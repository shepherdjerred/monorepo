package com.shepherdjerred.thestorm.towns.domain.protection;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Hurting, pushing and pulling players, pets and entities: PvP on both sides, pets, bypass. */
final class HarmTest {

  private static final Land WILD = new Land.Wilderness();
  private static final Land A_SAFE = Fixtures.land(TOWN_A);
  private static final Land A_PVP = Fixtures.land(TOWN_A, ClaimFlag.PVP);
  private static final Land A_PVP_ENTITIES =
      Fixtures.land(TOWN_A, ClaimFlag.PVP, ClaimFlag.PUBLIC_ENTITIES);
  private static final Land A_ENTITIES = Fixtures.land(TOWN_A, ClaimFlag.PUBLIC_ENTITIES);
  private static final Land SPAWN = new Land.RegionLand(Fixtures.region("spawn"));
  private static final Land ARENA =
      new Land.RegionLand(
          Fixtures.region("arena", Fixtures.allow(Action.ATTACK_PLAYER, Subject.PLAYER)));

  private final ProtectionEngine engine = new ProtectionEngine(Fixtures.trust());

  static Stream<Case> cases() {
    var other = new Victim.OtherPlayer();
    var pet = new Victim.OthersPet();
    var animal = new Victim.Protected(Subject.ANIMAL);
    return Stream.of(
        // Always allowed, even in safe land.
        new Case("self in spawn", new Victim.Self(), SPAWN, SPAWN, true),
        new Case("own pet in safe claim", new Victim.OwnPet(), A_SAFE, A_SAFE, true),
        new Case("hostile mob in spawn", new Victim.Unprotected(), SPAWN, SPAWN, true),
        // Other players: PvP must be on where both stand.
        new Case("player, both wild", other, WILD, WILD, true),
        new Case("player, both in PvP claim", other, A_PVP, A_PVP, true),
        new Case("player into safe claim", other, WILD, A_SAFE, false),
        new Case("player out of safe claim", other, A_SAFE, WILD, false),
        new Case("player in spawn", other, SPAWN, SPAWN, false),
        new Case("player from spawn into wild", other, SPAWN, WILD, false),
        new Case("player in arena", other, ARENA, ARENA, true),
        new Case("player from arena into spawn", other, ARENA, SPAWN, false),
        // Others' pets: never, anywhere.
        new Case("pet, both wild", pet, WILD, WILD, false),
        new Case("pet in PvP claim, entities closed", pet, WILD, A_PVP, false),
        new Case("pet in PvP claim, entities open", pet, A_PVP, A_PVP_ENTITIES, false),
        new Case("pet in safe claim, entities open", pet, WILD, A_ENTITIES, false),
        new Case("pet in the PvP arena", pet, ARENA, ARENA, false),
        // Protected entities: the land decides.
        new Case("animal in wild", animal, SPAWN, WILD, true),
        new Case("animal in claim", animal, WILD, A_SAFE, false),
        new Case("animal in open claim", animal, WILD, A_ENTITIES, true),
        new Case("animal in spawn", animal, WILD, SPAWN, false));
  }

  /** One row: an outsider hurting {@code victim} from {@code attackerLand}. */
  record Case(String name, Victim victim, Land attackerLand, Land victimLand, boolean allowed) {

    @Override
    public String toString() {
      return name;
    }
  }

  @ParameterizedTest(name = "{0}")
  @MethodSource("cases")
  void anOutsider(Case row) {
    assertThat(
            engine
                .decideHarm(Actor.player(NOMAD), row.attackerLand(), row.victim(), row.victimLand())
                .isAllowed())
        .isEqualTo(row.allowed());
  }

  @Test
  void aMemberMayHurtAnimalsOnTheirTownsLandButNotPlayers() {
    var member = Actor.player(MEMBER);

    assertThat(
            engine
                .decideHarm(member, A_SAFE, new Victim.Protected(Subject.ANIMAL), A_SAFE)
                .isAllowed())
        .isTrue();
    assertThat(engine.decideHarm(member, A_SAFE, new Victim.OtherPlayer(), A_SAFE))
        .isEqualTo(new Verdict.Deny(new Denial.NoPvp()));
  }

  @Test
  void bypassNeverTurnsPvpOn() {
    var staff = new Actor(NOMAD, true);

    assertThat(engine.decideHarm(staff, SPAWN, new Victim.OtherPlayer(), SPAWN).isAllowed())
        .isFalse();
    assertThat(engine.decideHarm(staff, WILD, new Victim.OthersPet(), A_SAFE).isAllowed())
        .isFalse();
    assertThat(
            engine
                .decideHarm(staff, WILD, new Victim.Protected(Subject.ITEM_FRAME), A_SAFE)
                .isAllowed())
        .isTrue();
  }

  @Test
  void anotherPlayersPetIsNeverTheirsToHurt() {
    assertThat(engine.decideHarm(Actor.player(NOMAD), WILD, new Victim.OthersPet(), WILD))
        .isEqualTo(new Verdict.Deny(new Denial.NotYourPet()));
    assertThat(engine.decideHarm(new Actor(NOMAD, true), WILD, new Victim.OthersPet(), WILD))
        .isEqualTo(new Verdict.Deny(new Denial.NotYourPet()));
  }
}
