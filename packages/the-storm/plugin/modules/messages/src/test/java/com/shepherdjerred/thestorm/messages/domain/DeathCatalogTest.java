package com.shepherdjerred.thestorm.messages.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class DeathCatalogTest {

  private static final TemplatePool MOBS = pool("{player} was ravaged by a {killer}");
  private static final TemplatePool CREEPERS = pool("{player} hugged a creeper");
  private static final TemplatePool PLAYERS = pool("{killer} killed {player} with {weapon}");
  private static final TemplatePool PLAYER_ARROWS = pool("{player} was shot by {killer}");

  @Test
  void playerKillsUseTheCauseListWhenThereIsOne() {
    var catalog = catalog();

    assertThat(catalog.poolFor(DeathCause.PROJECTILE, new Killer.Player()))
        .isEqualTo(PLAYER_ARROWS);
    assertThat(catalog.poolFor(DeathCause.MELEE, new Killer.Player())).isEqualTo(PLAYERS);
    assertThat(catalog.poolFor(DeathCause.LAVA, new Killer.Player())).isEqualTo(PLAYERS);
  }

  @Test
  void mobAttacksUseTheMobsList() {
    var catalog = catalog();

    assertThat(catalog.poolFor(DeathCause.EXPLOSION, new Killer.Mob("creeper")))
        .isEqualTo(CREEPERS);
    assertThat(catalog.poolFor(DeathCause.MELEE, new Killer.Mob("zombie"))).isEqualTo(MOBS);
    assertThat(catalog.poolFor(DeathCause.PROJECTILE, new Killer.Mob("skeleton"))).isEqualTo(MOBS);
    assertThat(catalog.poolFor(DeathCause.MAGIC, new Killer.Mob("witch"))).isEqualTo(MOBS);
  }

  @Test
  void signatureCausesBeatTheMob() {
    var catalog = catalog();

    assertThat(catalog.poolFor(DeathCause.SONIC_BOOM, new Killer.Mob("warden")))
        .isEqualTo(causePool(DeathCause.SONIC_BOOM));
    assertThat(catalog.poolFor(DeathCause.WIND_CHARGE, new Killer.Mob("breeze")))
        .isEqualTo(causePool(DeathCause.WIND_CHARGE));
  }

  @Test
  void deathsWithoutAKillerUseTheCauseList() {
    var catalog = catalog();

    for (var cause : DeathCause.values()) {
      assertThat(catalog.poolFor(cause, new Killer.None())).isEqualTo(causePool(cause));
    }
  }

  @Test
  void picksDeterministicallyFromASeed() {
    var catalog = catalogWithFallLines(8);

    assertThat(picks(catalog, new SplittableRandom(2014)))
        .isEqualTo(picks(catalog, new SplittableRandom(2014)));
  }

  @Test
  void picksEveryTemplateEventually() {
    var catalog = catalogWithFallLines(5);
    var seen = new HashSet<>(picks(catalog, new SplittableRandom(7)));

    assertThat(seen).hasSize(5);
  }

  @Test
  void rejectsAMissingCause() {
    var causes = causes();
    causes.remove(DeathCause.FREEZE);

    assertThatThrownBy(() -> new DeathCatalog(causes, mobs(), players()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("freeze");
  }

  @Test
  void causeListsMayOnlyNameThePlayer() {
    var causes = causes();
    causes.put(DeathCause.FALL, pool("{player} was pushed by {killer}"));

    assertThatThrownBy(() -> new DeathCatalog(causes, mobs(), players()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("cause fall cannot use {killer}");
  }

  @Test
  void mobListsCannotNameAWeapon() {
    assertThatThrownBy(() -> new DeathCatalog.Mobs(pool("{killer} used {weapon}"), Map.of()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("{weapon}");
    assertThatThrownBy(
            () -> new DeathCatalog.Mobs(MOBS, Map.of("creeper", pool("{killer} used {weapon}"))))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("mob creeper");
  }

  @Test
  void mobTypesAreBareLowercaseKeys() {
    assertThatThrownBy(() -> new DeathCatalog.Mobs(MOBS, Map.of("minecraft:creeper", CREEPERS)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Killer.Mob("Creeper"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void rejectsAnEmptyList() {
    assertThatThrownBy(() -> TemplatePool.parse(List.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  private static List<String> picks(DeathCatalog catalog, SplittableRandom random) {
    var picked = new ArrayList<String>();
    for (var i = 0; i < 50; i++) {
      picked.add(catalog.pick(DeathCause.FALL, new Killer.None(), random).source());
    }
    return picked;
  }

  private static DeathCatalog catalogWithFallLines(int count) {
    var lines = new ArrayList<String>();
    for (var i = 0; i < count; i++) {
      lines.add("{player} fell, take " + i);
    }
    var causes = causes();
    causes.put(DeathCause.FALL, TemplatePool.parse(lines));
    return new DeathCatalog(causes, mobs(), players());
  }

  private static DeathCatalog catalog() {
    return new DeathCatalog(causes(), mobs(), players());
  }

  private static EnumMap<DeathCause, TemplatePool> causes() {
    var causes = new EnumMap<DeathCause, TemplatePool>(DeathCause.class);
    Arrays.stream(DeathCause.values()).forEach(cause -> causes.put(cause, causePool(cause)));
    return causes;
  }

  private static TemplatePool causePool(DeathCause cause) {
    return pool("{player} died of " + cause.key());
  }

  private static DeathCatalog.Mobs mobs() {
    return new DeathCatalog.Mobs(MOBS, Map.of("creeper", CREEPERS));
  }

  private static DeathCatalog.Players players() {
    return new DeathCatalog.Players(PLAYERS, Map.of(DeathCause.PROJECTILE, PLAYER_ARROWS));
  }

  private static TemplatePool pool(String... lines) {
    return TemplatePool.parse(List.of(lines));
  }
}
