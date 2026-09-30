package com.shepherdjerred.thestorm.skills.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.skills.domain.Skill;
import java.lang.reflect.Proxy;
import org.bukkit.Material;
import org.bukkit.entity.Arrow;
import org.bukkit.entity.Entity;
import org.bukkit.entity.SpectralArrow;
import org.bukkit.entity.ThrownPotion;
import org.bukkit.entity.Trident;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

final class SkillActivitiesTest {

  @BeforeAll
  static void startServer() {
    MockBukkit.mock();
  }

  @AfterAll
  static void stopServer() {
    MockBukkit.unmock();
  }

  @Test
  void immaturePlacedCropsMustBeTrackedUntilHarvest() {
    for (var crop :
        new Material[] {
          Material.WHEAT,
          Material.CARROTS,
          Material.POTATOES,
          Material.BEETROOTS,
          Material.NETHER_WART,
          Material.COCOA,
          Material.SWEET_BERRY_BUSH
        }) {
      assertThat(SkillActivities.isCrop(crop)).as(crop.name()).isTrue();
    }
    assertThat(SkillActivities.isCrop(Material.STONE)).isFalse();
  }

  @Test
  void fertilizationTracksTreeStartersAndHarvestablePlants() {
    for (var starter :
        new Material[] {
          Material.OAK_SAPLING,
          Material.MANGROVE_PROPAGULE,
          Material.AZALEA,
          Material.FLOWERING_AZALEA,
          Material.CRIMSON_FUNGUS,
          Material.WARPED_FUNGUS
        }) {
      assertThat(SkillActivities.isFertilizedTrackable(starter)).as(starter.name()).isTrue();
    }
    assertThat(SkillActivities.isFertilizedTrackable(Material.DANDELION)).isTrue();
    assertThat(SkillActivities.isFertilizedTrackable(Material.SHORT_GRASS)).isTrue();
    assertThat(SkillActivities.isFertilizedTrackable(Material.STONE)).isFalse();
  }

  @Test
  void grownTreesTrackEveryGatheringXpBlockType() {
    for (var material :
        new Material[] {
          Material.OAK_LOG,
          Material.WHEAT,
          Material.DANDELION,
          Material.SHORT_GRASS,
          Material.ROOTED_DIRT,
          Material.DIAMOND_ORE
        }) {
      assertThat(SkillActivities.isGeneratedHarvestable(material)).as(material.name()).isTrue();
    }
    assertThat(SkillActivities.isGeneratedHarvestable(Material.OAK_LEAVES)).isFalse();
    assertThat(SkillActivities.isGeneratedHarvestable(Material.STONE)).isFalse();
  }

  @Test
  void maceUsesAxesWhileUnclassifiedMeleeHasNoSkill() {
    assertThat(SkillActivities.melee(Material.MACE)).contains(Skill.AXES);
    assertThat(SkillActivities.melee(Material.IRON_AXE)).contains(Skill.AXES);
    assertThat(SkillActivities.melee(Material.IRON_SWORD)).contains(Skill.SWORDS);
    assertThat(SkillActivities.melee(Material.IRON_PICKAXE)).isEmpty();
  }

  @Test
  void archeryExcludesThrownWeaponsAndPotions() {
    assertThat(SkillActivities.isArcheryProjectile(projectile(Arrow.class))).isTrue();
    assertThat(SkillActivities.isArcheryProjectile(projectile(SpectralArrow.class))).isTrue();
    assertThat(SkillActivities.isArcheryProjectile(projectile(Trident.class))).isFalse();
    assertThat(SkillActivities.isArcheryProjectile(projectile(ThrownPotion.class))).isFalse();
  }

  private static Entity projectile(Class<? extends Entity> type) {
    return (Entity)
        Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, (_, _, _) -> null);
  }
}
