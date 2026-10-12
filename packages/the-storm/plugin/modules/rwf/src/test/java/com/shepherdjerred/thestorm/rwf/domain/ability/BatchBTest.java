package com.shepherdjerred.thestorm.rwf.domain.ability;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.CAROL;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.DAVE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Demolitions;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Frost;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Medic;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Teleporter;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Warper;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Batch B, the utility kits: Medic, Frost, Warper, Teleporter and Demolitions, against Red
 * Warfare's numbers.
 */
final class BatchBTest {

  /** A big match: 22 fighters, so Medics may heal. */
  private static Bout big(String aliceKit) {
    var bout = new Bout().with(ALICE, TeamColor.RED, aliceKit);
    bout.with(BOB, TeamColor.RED, "trooper").with(CAROL, TeamColor.BLUE, "trooper");
    for (var i = 0; i < 19; i++) {
      bout.with(extra(i), i % 2 == 0 ? TeamColor.RED : TeamColor.BLUE, "trooper");
    }
    return bout;
  }

  /** The {@code i}th extra fighter of a big match. */
  private static CombatantId extra(int i) {
    return new CombatantId.Human(
        java.util.UUID.nameUUIDFromBytes(
            ("extra" + i).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  }

  private static AbilityInput.Heal wave(AbilityInput.Patient... patients) {
    return new AbilityInput.Heal(List.of(patients), 1, 20, 20);
  }

  @Nested
  final class MedicKit {

    @Test
    void healsSevenLessDistanceLessNearbyMedics() {
      var bout = big("medic");
      bout.start();

      var effects = bout.act(ALICE, wave(new AbilityInput.Patient(BOB, 2, 10, 20, false, false)));

      assertThat(effects).contains(new AbilityEffect.Heal(BOB, 4));
      assertThat(effects)
          .anyMatch(
              e ->
                  e instanceof AbilityEffect.Say say
                      && say.to().equals(List.of(BOB))
                      && say.text().endsWith(" has healed you!"));
      assertThat(bout.abilities.ready(ALICE, Medic.cooldown(BOB), bout.now)).isFalse();
      bout.advance(Duration.ofMillis(1200));
      assertThat(bout.abilities.ready(ALICE, Medic.cooldown(BOB), bout.now))
          .as("4 health heals back in 1.2 seconds")
          .isTrue();
    }

    @Test
    void neverHealsEnemiesMedicsPoisonedOrHealthyAllies() {
      var bout = big("medic");
      bout.fighters.set(1, new Fighter(BOB, "Bob", TeamColor.RED, "medic", true));
      bout.start();

      assertThat(
              bout.act(
                  ALICE,
                  wave(
                      new AbilityInput.Patient(BOB, 1, 10, 20, false, false),
                      new AbilityInput.Patient(CAROL, 1, 10, 20, false, false))))
          .noneMatch(AbilityEffect.Heal.class::isInstance);
      var dave = extra(0);
      assertThat(bout.act(ALICE, wave(new AbilityInput.Patient(dave, 1, 10, 20, true, false))))
          .noneMatch(AbilityEffect.Heal.class::isInstance);
      assertThat(bout.act(ALICE, wave(new AbilityInput.Patient(dave, 1, 20, 20, false, false))))
          .noneMatch(AbilityEffect.Heal.class::isInstance);
    }

    @Test
    void anAllyGetsFiftyHealthInAllThenOnlyRegeneration() {
      var bout = big("medic");
      bout.start();
      var healed = 0.0;
      for (var i = 0; i < 20; i++) {
        for (var effect :
            bout.act(ALICE, wave(new AbilityInput.Patient(BOB, 1, 2, 20, false, false)))) {
          if (effect instanceof AbilityEffect.Heal heal && heal.id().equals(BOB)) {
            healed += heal.amount();
          }
        }
        bout.advance(Duration.ofSeconds(5));
      }

      assertThat(healed).isCloseTo(Medic.LIMIT, within(1e-9));
      assertThat(bout.act(ALICE, wave(new AbilityInput.Patient(BOB, 1, 2, 20, false, false))))
          .contains(new AbilityEffect.Potion(BOB, "regeneration", 0, 50, Optional.of(ALICE)));
    }

    @Test
    void smallGamesAndThePoisonTurnHealingOff() {
      var small = big("medic");
      small.online = Medic.SMALL_GAME;

      assertThat(small.start()).isEmpty();
      small.advance(Medic.WARN_AFTER);
      assertThat(small.tick(Map.of(ALICE, Bout.still(Vec3.ZERO))))
          .contains(
              new AbilityEffect.Say(
                  List.of(ALICE),
                  "§6As this is a small game, your heals are disabled!",
                  AbilityEffect.Tone.LEGACY));
      assertThat(small.act(ALICE, wave(new AbilityInput.Patient(BOB, 1, 10, 20, false, false))))
          .isEmpty();
    }

    @Test
    void aMedicWhoHealedLittleIsScoldedOnDeath() {
      var bout = big("medic");
      bout.start();

      assertThat(bout.die(ALICE, Optional.of(CAROL), Map.of()))
          .contains(
              new AbilityEffect.Say(
                  List.of(ALICE),
                  "§6You need to improve your medic skills, heal more people!",
                  AbilityEffect.Tone.LEGACY));
    }
  }

  @Nested
  final class FrostKit {

    @Test
    void frostArmourSoftensBlowsByAnEighthPerPiece() {
      var hit = DamageFormula.Hit.melee(KitBook.TROOPER.hotbar().getFirst(), KitBook.FROST.armor());
      var plain = DamageFormula.finalDamage(hit);

      var taken =
          KitCombat.damage(
              hit,
              Optional.of(new KitCombat.Side("trooper", KitState.NONE)),
              new KitCombat.Side("frost", KitState.NONE),
              new SplittableRandom(1));

      assertThat(taken).isCloseTo(plain * 0.5, within(1e-9));
    }

    @Test
    void aSwordHitFreezesHandsForTenSecondsAndRechargesForSixteen() {
      var bout =
          new Bout().with(ALICE, TeamColor.RED, "frost").with(BOB, TeamColor.BLUE, "trooper");
      bout.start();

      var effects = bout.hit(ALICE, BOB, AttackType.MELEE, "IRON_SWORD");

      assertThat(effects)
          .contains(
              new AbilityEffect.Hands(BOB, true),
              new AbilityEffect.Cooldown(ALICE, Frost.ID, Frost.RECHARGE));
      assertThat(bout.hit(ALICE, BOB, AttackType.MELEE, "IRON_SWORD"))
          .as("still recharging")
          .noneMatch(AbilityEffect.Hands.class::isInstance);
      bout.advance(Duration.ofSeconds(10));
      assertThat(bout.tick(Map.of()))
          .as("Red Warfare thawed only once more than ten seconds had passed")
          .noneMatch(AbilityEffect.Hands.class::isInstance);
      bout.advance(Duration.ofMillis(50));
      assertThat(bout.tick(Map.of()))
          .contains(
              new AbilityEffect.Hands(BOB, false),
              new AbilityEffect.Say(
                  List.of(BOB), "§c§kab§c You thawed out", AbilityEffect.Tone.LEGACY),
              new AbilityEffect.Cue(BOB, KitCue.THAWED));
    }

    @Test
    void fireThawsFrozenHands() {
      var bout = new Bout().with(ALICE, TeamColor.RED, "frost").with(BOB, TeamColor.BLUE, "pyro");
      bout.start();
      bout.hit(ALICE, BOB, AttackType.MELEE, "IRON_SWORD");

      var effects = bout.act(BOB, new AbilityInput.Hurt(Optional.empty(), AttackType.FIRE_TICK, 1));

      assertThat(effects)
          .contains(new AbilityEffect.Hands(BOB, false))
          .noneMatch(AbilityEffect.Cue.class::isInstance);
    }
  }

  @Nested
  final class WarperKit {

    private static Motion at(double x) {
      return Bout.still(new Vec3(x, 64, 0));
    }

    @Test
    void startsRechargingThenWarpsEnemiesToWhereItStoodTenSecondsAgo() {
      var bout =
          new Bout()
              .with(ALICE, TeamColor.RED, "warper")
              .with(BOB, TeamColor.BLUE, "trooper")
              .with(CAROL, TeamColor.RED, "trooper");
      assertThat(bout.start())
          .contains(new AbilityEffect.Cooldown(ALICE, Warper.ID, Duration.ofSeconds(10)));
      for (var second = 0; second <= 12; second++) {
        bout.tick(Map.of(ALICE, at(second)));
        bout.advance(Duration.ofSeconds(1));
      }

      var effects = bout.act(ALICE, new AbilityInput.Warp(List.of(BOB, CAROL)));

      assertThat(effects)
          // Red Warfare dropped a spot only once the next was more than 10 seconds old.
          .contains(new AbilityEffect.Send(BOB, new Vec3(1, 64, 0), 0, 0, Optional.of(ALICE)))
          .noneMatch(e -> e instanceof AbilityEffect.Send t && t.id().equals(CAROL))
          .contains(
              new AbilityEffect.Say(
                  List.of(BOB), "§3Warped by §c" + bout.name(ALICE), AbilityEffect.Tone.LEGACY))
          .contains(new AbilityEffect.Cooldown(ALICE, Warper.ID, Warper.RECHARGE));
      assertThat(bout.state(ALICE, Warper.State.class).trail()).isEmpty();
    }

    @Test
    void refusesWhileRechargingOrWithNoTrail() {
      var bout =
          new Bout().with(ALICE, TeamColor.RED, "warper").with(BOB, TeamColor.BLUE, "trooper");
      bout.start();

      assertThat(bout.act(ALICE, new AbilityInput.Warp(List.of(BOB))))
          .containsExactly(
              new AbilityEffect.Say(
                  List.of(ALICE), "§cYour wand has not recharged yet!", AbilityEffect.Tone.LEGACY));
      bout.advance(Duration.ofSeconds(11));
      assertThat(bout.act(ALICE, new AbilityInput.Warp(List.of(BOB))))
          .containsExactly(
              new AbilityEffect.Say(
                  List.of(ALICE),
                  "§cNo landing spots found in the last 10 seconds!",
                  AbilityEffect.Tone.LEGACY));
    }
  }

  @Nested
  final class TeleporterKit {

    private static final BlockPos A = new BlockPos(0, 64, 0);
    private static final BlockPos B = new BlockPos(30, 64, 0);

    private Bout bout() {
      var bout =
          new Bout()
              .with(ALICE, TeamColor.RED, "teleporter")
              .with(BOB, TeamColor.RED, "trooper")
              .with(CAROL, TeamColor.BLUE, "trooper");
      bout.bombs.add(new BlockPos(10, 64, 10));
      bout.start();
      return bout;
    }

    private static AbilityInput place(BlockPos at) {
      return new AbilityInput.PlaceTeleporter(at, Optional.empty(), 0);
    }

    @Test
    void placesTwoAndAnAllySneakingOnOneCrossesToTheOther() {
      var bout = bout();

      assertThat(bout.act(ALICE, place(A)))
          .contains(new AbilityEffect.PlaceBlock(A, Teleporter.BLOCK));
      bout.act(ALICE, place(B));
      assertThat(bout.act(ALICE, place(new BlockPos(5, 64, 5))))
          .contains(
              new AbilityEffect.Say(
                  List.of(ALICE),
                  "You already have two teleporters placed!",
                  AbilityEffect.Tone.REFUSED));

      var crossed = bout.act(BOB, new AbilityInput.UseTeleporter(A, true));
      assertThat(crossed)
          .contains(new AbilityEffect.Teleport(BOB, new Vec3(30.5, 65.2, 0.5), Optional.empty()));
      assertThat(bout.act(BOB, new AbilityInput.UseTeleporter(A, true)))
          .as("two seconds between trips")
          .isEmpty();
      assertThat(bout.act(CAROL, new AbilityInput.UseTeleporter(A, true)))
          .as("the enemy cannot use it")
          .isEmpty();
    }

    @Test
    void neverOnABombsColumnAndARemoteOneIsUnstableForEightSeconds() {
      var bout = bout();

      var bomb = new BlockPos(10, 63, 10);
      assertThat(Teleporter.nearBomb(bomb, List.of(new BlockPos(10, 64, 10)))).isTrue();
      assertThat(
              bout.act(
                  ALICE,
                  new AbilityInput.PlaceTeleporter(
                      bomb,
                      Optional.empty(),
                      0,
                      new AbilityInput.Site(true, true, true, true, true))))
          .contains(
              new AbilityEffect.Say(
                  List.of(ALICE),
                  "Teleporter cannot be placed this close to a bomb!",
                  AbilityEffect.Tone.REFUSED));
      bout.act(ALICE, place(A));
      var remote = bout.act(ALICE, new AbilityInput.PlaceTeleporter(B, Optional.of(BOB), 40));
      assertThat(remote)
          .contains(new AbilityEffect.Cooldown(ALICE, Teleporter.REMOTE, Duration.ofSeconds(20)));
      assertThat(bout.act(BOB, new AbilityInput.UseTeleporter(A, true))).isEmpty();
      bout.advance(Duration.ofSeconds(8));
      assertThat(bout.act(BOB, new AbilityInput.UseTeleporter(A, true)))
          .as("still stabilising at exactly eight seconds, as elasped")
          .isEmpty();
      bout.advance(Duration.ofMillis(50));
      assertThat(bout.act(BOB, new AbilityInput.UseTeleporter(A, true)))
          .anyMatch(AbilityEffect.Teleport.class::isInstance);
    }

    @Test
    void theEnemyOrOwnerBreaksOneAndAllGoWithTheOwner() {
      var bout = bout();
      bout.act(ALICE, place(A));
      bout.act(ALICE, place(B));

      assertThat(bout.act(BOB, new AbilityInput.BreakTeleporter(A)))
          .noneMatch(AbilityEffect.ClearBlock.class::isInstance);
      assertThat(bout.act(CAROL, new AbilityInput.BreakTeleporter(A)))
          .contains(new AbilityEffect.ClearBlock(A));
      assertThat(bout.die(ALICE, Optional.of(CAROL), Map.of()))
          .contains(new AbilityEffect.ClearBlock(B));
      assertThat(bout.abilities.placed()).isEmpty();
    }
  }

  @Nested
  final class DemolitionsKit {

    private static final BlockPos MINE = new BlockPos(3, 64, 3);

    @Test
    void aMineArmsSetsOffOnAnEnemyAndExplodesSevenTenthsLater() {
      var bout =
          new Bout()
              .with(ALICE, TeamColor.RED, "demolitions")
              .with(BOB, TeamColor.RED, "trooper")
              .with(CAROL, TeamColor.BLUE, "trooper");
      bout.start();
      var still = Map.<CombatantId, Motion>of(ALICE, Bout.still(Vec3.ZERO));

      assertThat(bout.act(ALICE, new AbilityInput.PlaceMine(MINE)))
          .contains(new AbilityEffect.PlaceBlock(MINE, Demolitions.PLATE));
      assertThat(bout.act(CAROL, new AbilityInput.StepOnMine(MINE))).as("not armed yet").isEmpty();
      bout.advance(Duration.ofSeconds(2));
      assertThat(bout.tick(still)).as("strictly after two seconds").isEmpty();
      bout.advance(Duration.ofMillis(50));
      assertThat(bout.tick(still)).contains(new AbilityEffect.CueAt(MINE, KitCue.MINE_ARMED));
      assertThat(bout.act(BOB, new AbilityInput.StepOnMine(MINE))).as("an ally is safe").isEmpty();
      assertThat(bout.act(CAROL, new AbilityInput.StepOnMine(MINE)))
          .as("an armed mine ignores feet for its first tenth of a second")
          .isEmpty();
      bout.advance(Duration.ofMillis(150));
      assertThat(bout.act(CAROL, new AbilityInput.StepOnMine(MINE)))
          .contains(new AbilityEffect.CueAt(MINE, KitCue.MINE_TRIGGERED));
      bout.advance(Duration.ofMillis(700));
      assertThat(bout.tick(still)).noneMatch(AbilityEffect.Explode.class::isInstance);
      bout.advance(Duration.ofMillis(50));
      assertThat(bout.tick(still))
          .contains(
              new AbilityEffect.Explode(
                  MINE.center(), 6, 30, ALICE, KitAttacks.LANDMINE, KitAttacks.LANDMINE, 0));
      bout.advance(Duration.ofSeconds(40));
      assertThat(bout.tick(still)).noneMatch(AbilityEffect.Give.class::isInstance);
      bout.advance(Duration.ofMillis(50));
      assertThat(bout.tick(still))
          .contains(
              new AbilityEffect.Give(ALICE, Demolitions.landmine(), Integer.MAX_VALUE),
              new AbilityEffect.Cue(ALICE, KitCue.RESTOCKED));
    }

    @Test
    void nobodyBreaksAMineAndEveryMineGoesWithItsOwner() {
      var bout =
          new Bout()
              .with(ALICE, TeamColor.RED, "demolitions")
              .with(DAVE, TeamColor.BLUE, "trooper");
      bout.start();
      bout.act(ALICE, new AbilityInput.PlaceMine(MINE));
      bout.act(ALICE, new AbilityInput.PlaceMine(MINE.plus(1, 0, 0)));
      var alice = bout.fighters.getFirst().name();

      assertThat(bout.act(ALICE, new AbilityInput.BreakMine(MINE)))
          .containsExactly(
              new AbilityEffect.Say(
                  List.of(ALICE),
                  "§6This is §c" + alice + "'s §6landmine",
                  AbilityEffect.Tone.INFO));
      assertThat(bout.act(DAVE, new AbilityInput.BreakMine(MINE)))
          .containsExactly(
              new AbilityEffect.Say(
                  List.of(DAVE),
                  "§6This is §c" + alice + "'s §6landmine",
                  AbilityEffect.Tone.INFO));
      assertThat(bout.die(ALICE, Optional.of(DAVE), Map.of()))
          .contains(
              new AbilityEffect.ClearBlock(MINE), new AbilityEffect.ClearBlock(MINE.plus(1, 0, 0)));
      assertThat(bout.abilities.placed()).isEmpty();
    }
  }
}
