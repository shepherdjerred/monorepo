package com.shepherdjerred.thestorm.spells.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import org.bukkit.Material;
import org.bukkit.Particle;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

final class PaperNamesTest {

  private final Harness harness = new Harness();

  @AfterEach
  void tearDown() {
    harness.close();
  }

  @Test
  void everyNameInTheShippedConfigResolves() {
    assertThat(PaperNames.problems(harness.config)).isEmpty();
  }

  @Test
  void legacyAndMisspelledNamesDoNotResolve() {
    assertThat(PaperNames.item("REDSTONE")).contains(Material.REDSTONE);
    assertThat(PaperNames.item("INK_SACK")).isEmpty();
    assertThat(PaperNames.item("LEGACY_STONE")).isEmpty();
    assertThat(PaperNames.entityType("ZOMBIFIED_PIGLIN")).isPresent();
    assertThat(PaperNames.entityType("PIG_ZOMBIE")).isEmpty();
    assertThat(PaperNames.entityType("ARROW")).isEmpty();
  }

  @Test
  void onlyDataFreeParticlesAreAccepted() {
    assertThat(PaperNames.particle("FLAME")).contains(Particle.FLAME);
    assertThat(PaperNames.particle("DUST")).isEmpty();
    assertThat(PaperNames.particle("flame")).isEmpty();
  }

  @Test
  void temporaryBlocksMustBeSolidAndHoldNothing() {
    assertThat(PaperNames.solid("DEEPSLATE_BRICKS")).contains(Material.DEEPSLATE_BRICKS);
    assertThat(PaperNames.solid("CHEST")).isEmpty();
    assertThat(PaperNames.solid("SAND")).isEmpty();
    assertThat(PaperNames.solid("SHORT_GRASS")).isEmpty();
    assertThat(PaperNames.solid("TINTED_GLASS")).contains(Material.TINTED_GLASS);
  }

  @Test
  void temporaryBlocksMustNotChangeByThemselves() {
    assertThat(PaperNames.solid("OAK_LEAVES")).isEmpty();
    assertThat(PaperNames.solid("GRAVEL")).isEmpty();
    assertThat(PaperNames.solid("WHITE_CONCRETE_POWDER")).isEmpty();
    assertThat(PaperNames.solid("TNT")).isEmpty();
    assertThat(PaperNames.solid("ICE")).isEmpty();
    assertThat(PaperNames.solid("PACKED_ICE")).contains(Material.PACKED_ICE);
  }

  @Test
  void soundsResolveByEventKey() {
    assertThat(PaperNames.sound("entity.blaze.shoot")).isPresent();
    assertThat(PaperNames.sound("entity.blaze.shout")).isEmpty();
  }
}
