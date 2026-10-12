package com.shepherdjerred.thestorm.rwf.domain.ability;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.CAROL;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.DAVE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Dwarf;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Inertia;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Sacrificial;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** Batch D: Dwarf, Sacrificial and Inertia. */
final class BatchDTest {

  private static Motion moving(boolean sneaking, boolean sprinting, double speed, double yaw) {
    var radians = Math.toRadians(yaw);
    var velocity = new Vec3(-Math.sin(radians) * speed, 0, Math.cos(radians) * speed);
    return new Motion(
        Vec3.ZERO, velocity, yaw, 0, sneaking, sprinting, true, 20, 20, false, false, true);
  }

  private static Motion sneaking() {
    return moving(true, false, 0, 0);
  }

  private static Motion sprinting(double yaw) {
    return moving(false, true, 0.28, yaw);
  }

  private static Motion slamming() {
    return new Motion(Vec3.ZERO, Vec3.ZERO, 0, 0, false, true, true, 20, 20, true, false, true);
  }

  /** Sets {@code id}'s kit state directly. */
  private static void set(Bout bout, CombatantId id, KitState state) {
    var states = new java.util.HashMap<>(bout.abilities.states());
    states.put(id, state);
    var a = bout.abilities;
    bout.abilities =
        new Abilities(
            states, a.shared(), a.cooldowns(), a.positions(), a.placed(), a.fielded(), a.online());
  }

  private static List<AbilityEffect> ticks(Bout bout, CombatantId id, Motion motion, int n) {
    var effects = new java.util.ArrayList<AbilityEffect>();
    for (var i = 0; i < n; i++) {
      effects.addAll(bout.tick(Map.of(id, motion)));
    }
    return effects;
  }

  @Nested
  final class DwarfKit {

    @Test
    void sneakingTwoHundredTicksGainsALevelAndItsGear() {
      var bout = new Bout().with(ALICE, TeamColor.RED, "dwarf");
      assertThat(bout.start()).contains(new AbilityEffect.Meter(ALICE, 0, 0));

      var effects = ticks(bout, ALICE, sneaking(), 210);

      assertThat(bout.state(ALICE, Dwarf.State.class).level()).isEqualTo(1);
      assertThat(effects).contains(new AbilityEffect.Cue(ALICE, KitCue.LEVEL_UP));
      assertThat(effects).contains(new AbilityEffect.Gear(ALICE, 0, 0, 0));
      assertThat(effects)
          .noneMatch(e -> e instanceof AbilityEffect.Potion potion && potion.id().equals(ALICE));
    }

    @Test
    void standingAtNothingLosesNothing() {
      var bout = new Bout().with(ALICE, TeamColor.RED, "dwarf");
      bout.start();

      assertThat(ticks(bout, ALICE, moving(false, false, 0, 0), 20)).isEmpty();
      assertThat(bout.state(ALICE, Dwarf.State.class)).isEqualTo(new Dwarf.State(0, 0));
    }

    @Test
    void sprintingLosesFourTimesFasterAndMoreAtHigherLevels() {
      var bout = new Bout().with(ALICE, TeamColor.RED, "dwarf");
      bout.start();
      set(bout, ALICE, new Dwarf.State(10, 0.5F));

      bout.tick(Map.of(ALICE, sprinting(0)));

      assertThat((double) bout.state(ALICE, Dwarf.State.class).progress())
          .isCloseTo(0.5 - 0.02 * 1.2, within(1e-6));
    }

    @Test
    void gearAndSlownessFollowTheLevel() {
      assertThat(List.of(Dwarf.sharpness(48), Dwarf.protection(48), Dwarf.blast(48)))
          .containsExactly(5, 6, 6);
      assertThat(List.of(Dwarf.sharpness(9), Dwarf.protection(12), Dwarf.blast(16)))
          .containsExactly(3, 2, 2);
      var bout = new Bout().with(ALICE, TeamColor.RED, "dwarf");
      bout.start();
      set(bout, ALICE, new Dwarf.State(6, 0.999F));

      var up = bout.tick(Map.of(ALICE, sneaking()));

      assertThat(up)
          .containsSubsequence(
              new AbilityEffect.Cue(ALICE, KitCue.LEVEL_UP),
              new AbilityEffect.ClearPotion(ALICE, "slowness"),
              new AbilityEffect.SwirlingPotion(ALICE, "slowness", 2, Dwarf.SLOWNESS_TICKS),
              new AbilityEffect.Gear(ALICE, 2, 1, 0));
      set(bout, ALICE, new Dwarf.State(7, 0.001F));
      var down = bout.tick(Map.of(ALICE, moving(false, false, 0, 0)));
      assertThat(down)
          .as("dropping from 7 to 6 sets amplifier 7 - 6, the new level's less one")
          .containsSubsequence(
              new AbilityEffect.Cue(ALICE, KitCue.LEVEL_DOWN),
              new AbilityEffect.ClearPotion(ALICE, "slowness"),
              new AbilityEffect.SwirlingPotion(ALICE, "slowness", 1, Dwarf.SLOWNESS_TICKS),
              new AbilityEffect.Gear(ALICE, 2, 1, 0));
      set(bout, ALICE, new Dwarf.State(6, 0.001F));
      assertThat(bout.tick(Map.of(ALICE, moving(false, false, 0, 0))))
          .as("dropping from 6 to 5 leaves Slowness I, as Red Warfare did")
          .contains(new AbilityEffect.SwirlingPotion(ALICE, "slowness", 0, Dwarf.SLOWNESS_TICKS));
      set(bout, ALICE, new Dwarf.State(5, 0.001F));
      assertThat(bout.tick(Map.of(ALICE, moving(false, false, 0, 0))))
          .as("below 6 the Slowness is never touched, so Slowness I stays")
          .noneMatch(AbilityEffect.SwirlingPotion.class::isInstance)
          .noneMatch(AbilityEffect.ClearPotion.class::isInstance);
      set(bout, ALICE, new Dwarf.State(4, 0.999F));
      assertThat(bout.tick(Map.of(ALICE, sneaking())))
          .as("climbing to 5 does not take it away either")
          .noneMatch(AbilityEffect.ClearPotion.class::isInstance);
    }
  }

  @Nested
  final class SacrificialKit {

    private Bout bout() {
      var bout =
          new Bout()
              .with(ALICE, TeamColor.RED, "sacrificial")
              .with(BOB, TeamColor.RED, "trooper")
              .with(CAROL, TeamColor.BLUE, "trooper")
              .with(DAVE, TeamColor.RED, "dwarf");
      bout.start();
      return bout;
    }

    @Test
    void bondsAnAllyAndTheMeterCountsBonds() {
      var bout = bout();

      var effects = bout.act(ALICE, new AbilityInput.Bond(BOB));

      assertThat(effects).contains(new AbilityEffect.Meter(ALICE, 1, -1));
      assertThat(Sacrificial.guardian(bout.abilities, BOB)).contains(ALICE);
      assertThat(bout.act(ALICE, new AbilityInput.Bond(BOB)))
          .anyMatch(
              e ->
                  e instanceof AbilityEffect.Say say
                      && say.text().equals("You've already claimed this warrior!"));
    }

    @Test
    void neverBondsEnemiesOrDwarves() {
      var bout = bout();

      assertThat(bout.act(ALICE, new AbilityInput.Bond(CAROL)))
          .anyMatch(
              e ->
                  e instanceof AbilityEffect.Say say
                      && say.text().equals("They are not on your team! Run away!"));
      assertThat(bout.act(ALICE, new AbilityInput.Bond(DAVE)))
          .anyMatch(
              e ->
                  e instanceof AbilityEffect.Say say
                      && say.text().equals("You cannot sacrifice a Dwarf!"));
      assertThat(Sacrificial.guardian(bout.abilities, CAROL)).isEmpty();
      assertThat(Sacrificial.guardian(bout.abilities, DAVE)).isEmpty();
    }

    @Test
    void anAllyHasOneSacrificial() {
      var bout = bout();
      bout.fighters.set(3, new Fighter(DAVE, "Dave", TeamColor.RED, "sacrificial", true));
      bout.start();
      bout.act(ALICE, new AbilityInput.Bond(BOB));

      assertThat(bout.act(DAVE, new AbilityInput.Bond(BOB)))
          .anyMatch(
              e ->
                  e instanceof AbilityEffect.Say say
                      && say.text()
                          .equals("This warrior has already been claimed by another sacrificial!"));
    }

    @Test
    void shearsSeverEveryBondTwiceThenAreGone() {
      var bout = bout();
      bout.act(ALICE, new AbilityInput.Bond(BOB));

      var first = bout.act(ALICE, new AbilityInput.Sever());

      assertThat(first)
          .contains(
              new AbilityEffect.Hear(ALICE, ALICE, KitCue.SNIPPED),
              new AbilityEffect.Hear(BOB, ALICE, KitCue.SNIPPED),
              new AbilityEffect.Take(ALICE, "SHEARS", 1));
      assertThat(Sacrificial.guardian(bout.abilities, BOB)).isEmpty();
      bout.act(ALICE, new AbilityInput.Bond(BOB));
      assertThat(bout.act(ALICE, new AbilityInput.Sever()))
          .contains(new AbilityEffect.Take(ALICE, "SHEARS", 1));
      bout.act(ALICE, new AbilityInput.Bond(BOB));
      assertThat(bout.act(ALICE, new AbilityInput.Sever())).as("both shears are gone").isEmpty();
    }

    @Test
    void directHitsHurtFourTimesButSacrificedDamageDoesNot() {
      var hit = DamageFormula.Hit.of(AttackType.MELEE, 2, List.of());
      var side = new KitCombat.Side("sacrificial", new Sacrificial.State(List.of(), 2));
      var random = new SplittableRandom(1);
      var trooper = Optional.of(new KitCombat.Side("trooper", KitState.NONE));

      assertThat(KitCombat.damage(hit, trooper, side, random)).isEqualTo(8);
      assertThat(
              KitCombat.damage(
                  DamageFormula.Hit.of(KitAttacks.SACRIFICED, 2, List.of()), trooper, side, random))
          .isEqualTo(2);
      assertThat(KitCombat.damage(hit, Optional.empty(), side, random))
          .as("only hits from someone are direct")
          .isEqualTo(2);
    }

    @Test
    void shieldsAllButInstantDeathAndTheVoid() {
      assertThat(Sacrificial.shields(AttackType.MELEE)).isTrue();
      assertThat(Sacrificial.shields(AttackType.FALL)).isTrue();
      assertThat(Sacrificial.shields(AttackType.VOID)).isFalse();
      assertThat(Sacrificial.shields(AttackType.SUICIDE)).isFalse();
      assertThat(Sacrificial.shields(KitAttacks.SACRIFICED)).isFalse();
    }

    @Test
    void steaksComeBackEveryTwentySecondsUpToMoreWhenBonded() {
      var bout = bout();
      var give = new AbilityEffect.Give(ALICE, Sacrificial.steak(), Integer.MAX_VALUE);

      assertThat(bout.act(ALICE, steaks(5))).as("five held alone: none").isEmpty();
      assertThat(bout.act(ALICE, steaks(4))).contains(give);
      assertThat(bout.act(ALICE, steaks(1))).as("recharging").isEmpty();
      bout.act(ALICE, new AbilityInput.Bond(BOB));
      bout.advance(Sacrificial.STEAK);
      var bonded = bout.act(ALICE, steaks(19));
      assertThat(bonded)
          .contains(
              give,
              new AbilityEffect.Say(
                  List.of(BOB),
                  "§cThe sacrificial sacrificing you has 20 steaks",
                  AbilityEffect.Tone.REFUSED))
          .noneMatch(e -> e instanceof AbilityEffect.Say say && say.text().contains("ease up"));
      bout.advance(Sacrificial.STEAK);
      assertThat(bout.act(ALICE, steaks(20))).as("twenty held: none").isEmpty();
      assertThat(bout.act(ALICE, steaks(3)))
          .contains(
              new AbilityEffect.Say(
                  List.of(BOB),
                  "§cThe sacrificial sacrificing you has 4 steaks",
                  AbilityEffect.Tone.REFUSED),
              new AbilityEffect.Say(
                  List.of(BOB),
                  "§cMay want to ease up on the fighting warrior!",
                  AbilityEffect.Tone.REFUSED));
    }

    private static AbilityInput steaks(int held) {
      return new AbilityInput.Stock(Sacrificial.STEAK_MATERIAL, held);
    }

    @Test
    void deathsBreakBonds() {
      var bout = bout();
      bout.act(ALICE, new AbilityInput.Bond(BOB));

      assertThat(bout.kill(BOB, CAROL))
          .contains(
              new AbilityEffect.Hear(ALICE, ALICE, KitCue.BOND_BROKEN),
              new AbilityEffect.Meter(ALICE, 0, -1));
      bout.act(ALICE, new AbilityInput.Bond(DAVE));
      assertThat(Sacrificial.guardian(bout.abilities, BOB)).isEmpty();

      var again = bout();
      again.act(ALICE, new AbilityInput.Bond(BOB));
      assertThat(again.kill(ALICE, CAROL))
          .contains(new AbilityEffect.Hear(BOB, BOB, KitCue.BOND_BROKEN));
      assertThat(Sacrificial.guardian(again.abilities, BOB)).isEmpty();
    }
  }

  @Nested
  final class InertiaKit {

    private Bout bout() {
      var bout =
          new Bout().with(ALICE, TeamColor.RED, "inertia").with(CAROL, TeamColor.BLUE, "trooper");
      bout.start();
      return bout;
    }

    @Test
    void momentumBuildsWhileSprintingStraightAndPowersMelee() {
      var bout = bout();

      ticks(bout, ALICE, sprinting(90), 60);

      var run = bout.state(ALICE, Inertia.State.class);
      assertThat(run.momentum()).isEqualTo(Inertia.MOST);
      assertThat(run.bonus()).isEqualTo(Inertia.MOST_BONUS);
      var hit = DamageFormula.Hit.of(AttackType.MELEE, 4, List.of());
      assertThat(
              KitCombat.damage(
                  hit,
                  Optional.of(new KitCombat.Side("inertia", run)),
                  new KitCombat.Side("trooper", KitState.NONE),
                  new SplittableRandom(1)))
          .isEqualTo(8);
      var arrow = DamageFormula.Hit.of(AttackType.PROJECTILE, 4, List.of());
      assertThat(
              KitCombat.damage(
                  arrow,
                  Optional.of(new KitCombat.Side("inertia", run)),
                  new KitCombat.Side("trooper", KitState.NONE),
                  new SplittableRandom(1)))
          .as("only melee gains from the run")
          .isEqualTo(4);
    }

    @Test
    void gentleCurvesKeepMomentumAndSharpTurnsDropIt() {
      var bout = bout();
      ticks(bout, ALICE, sprinting(0), 20);
      for (var yaw = 0; yaw < 40; yaw += 2) {
        bout.tick(Map.of(ALICE, sprinting(yaw)));
      }
      assertThat(bout.state(ALICE, Inertia.State.class).momentum()).isEqualTo(Inertia.MOST);

      var turned = bout.tick(Map.of(ALICE, sprinting(140)));

      assertThat(bout.state(ALICE, Inertia.State.class).momentum()).isZero();
      assertThat(turned).contains(new AbilityEffect.Meter(ALICE, 0, 0));
    }

    @Test
    void stoppingBleedsMomentum() {
      var bout = bout();
      ticks(bout, ALICE, sprinting(0), 10);

      bout.tick(Map.of(ALICE, moving(false, false, 0, 0)));

      assertThat(bout.state(ALICE, Inertia.State.class).momentum()).isEqualTo(10 - Inertia.DECAY);
    }

    @Test
    void runningIntoAWallHurts() {
      var bout = bout();
      ticks(bout, ALICE, sprinting(0), 40);

      var slam = bout.tick(Map.of(ALICE, slamming()));

      assertThat(slam)
          .contains(
              new AbilityEffect.Damage(ALICE, Inertia.MOST_SLAM, KitAttacks.WALL, Optional.empty()),
              new AbilityEffect.Cue(ALICE, KitCue.SLAMMED));
      assertThat(bout.state(ALICE, Inertia.State.class).momentum()).isZero();
      ticks(bout, ALICE, sprinting(0), Inertia.SLAM_THRESHOLD - 1);
      assertThat(bout.tick(Map.of(ALICE, slamming())))
          .as("a short run bumps the wall harmlessly")
          .noneMatch(AbilityEffect.Damage.class::isInstance);
    }

    @Test
    void headingsWrapAround() {
      assertThat(Inertia.difference(350, 10)).isCloseTo(20, within(1e-9));
      assertThat(Inertia.difference(-170, 170)).isCloseTo(20, within(1e-9));
      assertThat(Inertia.follow(350, 10)).isCloseTo(352, within(1e-9));
    }
  }
}
