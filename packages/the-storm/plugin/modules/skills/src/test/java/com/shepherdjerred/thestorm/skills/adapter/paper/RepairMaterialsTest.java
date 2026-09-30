package com.shepherdjerred.thestorm.skills.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import org.bukkit.Material;
import org.junit.jupiter.api.Test;

final class RepairMaterialsTest {

  @Test
  void selectsOnlyKnownToolIngredients() {
    assertThat(RepairMaterials.ingredient(Material.IRON_PICKAXE)).contains(Material.IRON_INGOT);
    assertThat(RepairMaterials.ingredient(Material.DIAMOND_SWORD)).contains(Material.DIAMOND);
    assertThat(RepairMaterials.ingredient(Material.STONE_SHOVEL)).contains(Material.COBBLESTONE);
    assertThat(RepairMaterials.ingredient(Material.IRON_HELMET)).isEmpty();
    assertThat(RepairMaterials.ingredient(Material.STICK)).isEmpty();
  }
}
