package com.shepherdjerred.thestorm.messages.domain;

import static java.util.stream.Collectors.toUnmodifiableSet;
import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import org.bukkit.damage.DamageType;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;

final class DeathCauseTest {

  /**
   * Paper names every vanilla damage type as a constant on {@link DamageType}. Reading the field
   * names does not initialize the interface, so no server is needed.
   */
  @Test
  void mapsEveryVanillaDamageType() {
    var vanilla =
        Arrays.stream(DamageType.class.getFields())
            .filter(field -> Modifier.isStatic(field.getModifiers()))
            .map(Field::getName)
            .map(name -> "minecraft:" + name.toLowerCase(Locale.ROOT))
            .collect(toUnmodifiableSet());

    assertThat(vanilla).hasSizeGreaterThan(40);
    assertThat(DeathCause.knownDamageTypes()).containsExactlyInAnyOrderElementsOf(vanilla);
  }

  @Test
  void everyCauseHasADamageType() {
    var used =
        DeathCause.knownDamageTypes().stream()
            .map(key -> DeathCause.fromDamageType(key).orElseThrow())
            .collect(toUnmodifiableSet());

    assertThat(used).containsExactlyInAnyOrder(DeathCause.values());
  }

  @CsvSource({
    "minecraft:arrow, PROJECTILE",
    "minecraft:cactus, CACTUS",
    "minecraft:explosion, EXPLOSION",
    "minecraft:fall, FALL",
    "minecraft:falling_anvil, FALLING_BLOCK",
    "minecraft:falling_stalactite, STALACTITE",
    "minecraft:freeze, FREEZE",
    "minecraft:generic_kill, KILL",
    "minecraft:indirect_magic, MAGIC",
    "minecraft:mace_smash, MACE_SMASH",
    "minecraft:mob_attack, MELEE",
    "minecraft:on_fire, FIRE",
    "minecraft:out_of_world, VOID",
    "minecraft:player_attack, MELEE",
    "minecraft:sonic_boom, SONIC_BOOM",
    "minecraft:stalagmite, STALAGMITE",
    "minecraft:wind_charge, WIND_CHARGE"
  })
  @ParameterizedTest
  void mapsDamageTypes(String key, DeathCause cause) {
    assertThat(DeathCause.fromDamageType(key)).contains(cause);
  }

  @Test
  void doesNotGuessUnknownDamageTypes() {
    assertThat(DeathCause.fromDamageType("minecraft:not_a_thing")).isEmpty();
    assertThat(DeathCause.fromDamageType("fall")).isEmpty();
  }

  @EnumSource(DeathCause.class)
  @ParameterizedTest
  void roundTripsConfigKeys(DeathCause cause) {
    assertThat(DeathCause.fromKey(cause.key())).contains(cause);
    assertThat(cause.key()).isEqualTo(cause.name().toLowerCase(Locale.ROOT));
  }

  @Test
  void rejectsUnknownKeys() {
    assertThat(DeathCause.fromKey("FALL")).isEmpty();
    assertThat(DeathCause.fromKey("contact")).isEmpty();
  }

  @Test
  void onlyAttacksLetTheKillerSpeak() {
    var attacks =
        Arrays.stream(DeathCause.values())
            .filter(DeathCause::isAttack)
            .collect(toUnmodifiableSet());

    assertThat(attacks)
        .isEqualTo(
            Set.of(
                DeathCause.MELEE, DeathCause.PROJECTILE, DeathCause.EXPLOSION, DeathCause.MAGIC));
  }
}
