package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Berserker;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import java.nio.file.Path;
import org.bukkit.Material;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerVelocityEvent;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.util.Vector;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Batch A kits on MockBukkit, through the real listeners: the potions, max health, damage changes
 * and sprint rule each kit's ability gives in a live match.
 */
final class RwfKitsBatchATest {

  @TempDir Path directory;
  private @Nullable KitFight fight;

  @AfterEach
  void stop() {
    if (fight != null) {
      fight.close();
    }
  }

  private KitFight on(String kit) {
    fight = KitFight.on(directory, kit);
    return fight;
  }

  @Test
  void aNinjaRunsWithSpeedTwoAndNightVision() {
    var fight = on("ninja");

    var speed = requireNonNull(fight.alice.getPotionEffect(PotionEffectType.SPEED));
    assertThat(speed.getAmplifier()).isEqualTo(1);
    assertThat(fight.alice.hasPotionEffect(PotionEffectType.NIGHT_VISION)).isTrue();
    assertThat(KitFight.at(fight.alice, 2)).isEqualTo(Material.ENDER_PEARL);
  }

  @Test
  void aPyroCarriesItsFireGear() {
    var fight = on("pyro");

    assertThat(KitFight.at(fight.alice, 1)).isEqualTo(Material.IRON_SWORD);
    assertThat(KitFight.at(fight.alice, 2)).isEqualTo(Material.BOW);
    assertThat(KitFight.at(fight.alice, 9)).isEqualTo(Material.ARROW);
    assertThat(fight.alice.getInventory().getHelmet().getType()).isEqualTo(Material.LEATHER_HELMET);
  }

  @Test
  void aVenomsSwordPoisonsAndSlowsItsVictim() {
    var fight = on("venom");
    fight.alice.getInventory().setHeldItemSlot(1);

    fight.aliceHits();

    var poison = requireNonNull(fight.enemy.getPotionEffect(PotionEffectType.POISON));
    assertThat(poison.getDuration()).isEqualTo(120);
    assertThat(fight.enemy.hasPotionEffect(PotionEffectType.SLOWNESS)).isTrue();
  }

  @Test
  void aJuggernautHasFifteenHeartsTakesLessAndCannotSprint() {
    var fight = on("juggernaut");

    assertThat(KitFight.maxHealth(fight.alice)).isEqualTo(30);
    assertThat(fight.alice.getHealth()).isEqualTo(30);
    fight.enemyHits();
    var taken = 30 - fight.alice.getHealth();
    assertThat(taken).isPositive();
    var push = new PlayerVelocityEvent(fight.alice, new Vector(1, 0.5, 0));
    fight.harness.server.getPluginManager().callEvent(push);
    assertThat(push.getVelocity()).isEqualTo(new Vector(0.8, 0.4, 0));
    fight.alice.clearTeleported();
    fight.alice.setSprinting(true);
    var from = fight.alice.getLocation();
    fight
        .harness
        .server
        .getPluginManager()
        .callEvent(new PlayerMoveEvent(fight.alice, from, from.clone().add(0.3, 0, 0)));
    assertThat(fight.alice.hasTeleported())
        .as("a sprinting Juggernaut is put back where it stands")
        .isTrue();
  }

  @Test
  void aJuggernautBotsOwnSteeringIsNotCutButAHitStillPushesItAFifthLess() {
    // fairylands: every Juggernaut bot's jump peaked at 0.875 blocks, so it hopped in place at
    // every one-block step, because each tick's steering velocity was cut like a push.
    var trooper = on("trooper", "trooper");
    var trooperPush = pushedBy(trooper);
    trooper.close();
    var jugger = on("trooper", "juggernaut");
    var steering = new PlayerVelocityEvent(jugger.enemy, new Vector(0.1, 0.42, 0));
    jugger.harness.server.getPluginManager().callEvent(steering);
    assertThat(steering.getVelocity()).isEqualTo(new Vector(0.1, 0.42, 0));
    var juggerPush = pushedBy(jugger);
    assertThat(juggerPush.length()).isCloseTo(trooperPush.length() * 0.8, within(1e-9));
  }

  private static Vector pushedBy(KitFight fight) {
    fight.enemy.setVelocity(new Vector());
    fight.aliceHits();
    return fight.enemy.getVelocity();
  }

  private KitFight on(String kit, String botKit) {
    fight = KitFight.on(directory, kit, botKit);
    return fight;
  }

  @Test
  void aGoldenApplesAbsorptionTakesAHitBeforeHealth() {
    // tsmc: damage went straight past a golden apple's absorption hearts, as the rules set health.
    var fight = on("trooper");
    fight.alice.setAbsorptionAmount(4);

    fight.enemyHits();

    var taken = 24 - fight.alice.getHealth() - fight.alice.getAbsorptionAmount();
    assertThat(taken).isPositive();
    assertThat(fight.alice.getAbsorptionAmount()).isEqualTo(Math.max(0, 4 - taken));
    assertThat(fight.alice.getHealth()).isEqualTo(20 - Math.max(0, taken - 4));
  }

  @Test
  void aJuggernautTakesSixtyPercentOfATroopersHit() {
    var fight = on("juggernaut");

    fight.enemyHits();

    var full =
        DamageFormula.finalDamage(
            DamageFormula.Hit.melee(
                KitBook.TROOPER.hotbar().getFirst(), KitBook.JUGGERNAUT.armor()));
    assertThat(30 - fight.alice.getHealth()).isCloseTo(full * 0.6, within(1e-9));
  }

  @Test
  void aBerserkersKillAddsSevenTenthsToEveryHitBeforeArmor() {
    var fight = on("berserker");
    fight.alice.getInventory().setHeldItemSlot(1);
    var second = fight.anotherEnemy();
    fight.aliceHits();
    var calm = 20 - fight.enemy.getHealth();
    for (var i = 0; i < 40 && fight.enemyAlive(); i++) {
      fight.aliceHits();
      fight.harness.ticks(1);
    }
    assertThat(fight.enemyAlive()).isFalse();

    second.setNoDamageTicks(0);
    second.simulateDamage(1, fight.alice);
    var bloodied = 20 - second.getHealth();

    // A trooper's full iron takes 15/25 of the bonus away.
    assertThat(bloodied - calm).isCloseTo(Berserker.PER_KILL * 0.4, within(1e-6));
  }

  @Test
  void equalityTakesExactlyThree() {
    var fight = on("equality");

    fight.enemyHits();

    assertThat(fight.alice.getHealth()).isCloseTo(17, within(1e-9));
  }

  @Test
  void aVampireStartsAtEightHearts() {
    var fight = on("vampire");

    assertThat(KitFight.maxHealth(fight.alice)).isEqualTo(16);
    assertThat(fight.alice.getHealth()).isEqualTo(16);
  }

  @Test
  void aBleedersHitTakesMaxHealthForGood() {
    var fight = on("bleeder");
    fight.alice.getInventory().setHeldItemSlot(1);

    fight.aliceHits();

    var max = KitFight.maxHealth(fight.enemy);
    assertThat(max).isLessThan(20).isGreaterThanOrEqualTo(17);
    assertThat(20 - max).isCloseTo(20 - fight.enemy.getHealth(), within(1e-9));
  }

  @Test
  void kitChangesAreGoneWhenThePlayerLeaves() {
    var fight = on("juggernaut");

    fight.alice.performCommand("rwf leave");

    assertThat(KitFight.maxHealth(fight.alice)).isEqualTo(20);
  }
}
