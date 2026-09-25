package com.shepherdjerred.thestorm.spells.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.entity.Cow;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.util.Vector;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * The harm contract every creature-affecting spell goes through. Two residents of Aegis (a PvP-off
 * claim at x >= 0) must not be able to affect each other with any kind of rider; in the wilderness
 * every rider lands; and a blow whose damage is cancelled lands none of its riders.
 */
final class HarmTest {

  private final Harness harness = new Harness();
  private final FakeProtection protection = new FakeProtection();
  private final SpellState state = new SpellState();
  private final Harm harm =
      new Harm(new Guard(protection), state, harness.clock, Optional.of(this::serverDamage));
  private final List<String> extras = new ArrayList<>();

  private PlayerMock caster;

  /** Whether the server lets damage through; a god-mode plugin cancels it. */
  private boolean damageCancelled;

  /**
   * What the server does for magic damage: apply it unless a plugin cancels the damage event.
   * (MockBukkit cannot deal damage from a damage source itself.)
   */
  boolean serverDamage(LivingEntity target, double amount, Player source) {
    if (damageCancelled) {
      return false;
    }
    target.setHealth(Math.max(0, target.getHealth() - amount));
    return true;
  }

  private PlayerMock victim;

  @BeforeEach
  void setUp() {
    harness.server.getPluginManager().registerEvents(harm, harness.plugin);
    caster = harness.server.addPlayer();
    victim = harness.server.addPlayer();
    protection.residents.add(caster.getUniqueId());
    protection.residents.add(victim.getUniqueId());
  }

  @AfterEach
  void tearDown() {
    harness.close();
  }

  private void standIn(double x) {
    caster.teleport(new Location(harness.world, x, 64, 0));
    victim.teleport(new Location(harness.world, x + 2, 64, 0));
  }

  /** One blow per rider type, so each is checked on its own. */
  private List<Harm.Blow> everyRider() {
    return List.of(
        Harm.Blow.none().withDamage(4),
        Harm.Blow.none().withFire(100),
        Harm.Blow.none().withVelocity(new Vector(0, 2, 0)),
        Harm.Blow.none().withPotion(PotionEffectType.SLOWNESS, 100, 1),
        Harm.Blow.none().withFreeze(300),
        Harm.Blow.none().then(target -> extras.add("silence, disarm, entomb or aggro")));
  }

  private void assertUntouched(LivingEntity target, double health) {
    assertThat(target.getHealth()).isEqualTo(health);
    assertThat(target.getFireTicks()).isLessThanOrEqualTo(0);
    assertThat(target.getVelocity().getY()).isLessThan(1);
    assertThat(target.getActivePotionEffects()).isEmpty();
    assertThat(target.getFreezeTicks()).isZero();
    assertThat(extras).isEmpty();
  }

  @Test
  void residentsInAPvpOffClaimCannotAffectEachOtherWithAnyRider() {
    standIn(10);
    var health = victim.getHealth();

    for (var blow : everyRider()) {
      assertThat(harm.strike(caster, victim, blow)).as("%s", blow).isFalse();
    }

    assertUntouched(victim, health);
  }

  @Test
  void aCasterInsideAPvpOffClaimCannotReachAPlayerOutsideIt() {
    caster.teleport(new Location(harness.world, 1, 64, 0));
    victim.teleport(new Location(harness.world, -3, 64, 0));
    var health = victim.getHealth();

    for (var blow : everyRider()) {
      assertThat(harm.strike(caster, victim, blow)).isFalse();
    }

    assertUntouched(victim, health);
  }

  @Test
  void inTheWildernessEveryRiderLands() {
    standIn(-50);
    var health = victim.getHealth();

    for (var blow : everyRider()) {
      assertThat(harm.strike(caster, victim, blow)).as("%s", blow).isTrue();
    }

    assertThat(victim.getHealth()).isLessThan(health);
    assertThat(victim.getFireTicks()).isPositive();
    assertThat(victim.getVelocity().getY()).isEqualTo(2);
    assertThat(victim.getActivePotionEffects())
        .extracting(PotionEffect::getType)
        .containsExactly(PotionEffectType.SLOWNESS);
    assertThat(victim.getFreezeTicks()).isEqualTo(300);
    assertThat(extras).hasSize(1);
  }

  @Test
  void aCancelledHitLandsNoneOfItsRiders() {
    standIn(-50);
    damageCancelled = true;
    var health = victim.getHealth();

    var blow =
        Harm.Blow.none()
            .withDamage(4)
            .withFire(100)
            .withVelocity(new Vector(0, 2, 0))
            .withPotion(PotionEffectType.SLOWNESS, 100, 1)
            .withFreeze(300)
            .then(target -> extras.add("rider"));

    assertThat(harm.strike(caster, victim, blow)).isFalse();
    assertUntouched(victim, health);
  }

  @Test
  void animalsInAForeignClaimAreSpared() {
    protection.residents.remove(caster.getUniqueId());
    caster.teleport(new Location(harness.world, -5, 64, 0));
    var cow = harness.world.spawn(new Location(harness.world, 5, 64, 0), Cow.class);
    var health = cow.getHealth();

    for (var blow : everyRider()) {
      assertThat(harm.strike(caster, cow, blow)).isFalse();
    }

    assertUntouched(cow, health);
  }

  @Test
  void affectingACreatureEndsTheCastersStealth() {
    standIn(10);
    state.stealth().start(caster.getUniqueId(), Duration.ofSeconds(20), harness.clock.instant());
    caster.addPotionEffect(new PotionEffect(PotionEffectType.INVISIBILITY, 400, 0));

    harm.strike(caster, victim, Harm.Blow.none().withDamage(1));

    assertThat(state.stealth().running(caster.getUniqueId(), harness.clock.instant())).isFalse();
    assertThat(caster.hasPotionEffect(PotionEffectType.INVISIBILITY)).isFalse();
  }
}
