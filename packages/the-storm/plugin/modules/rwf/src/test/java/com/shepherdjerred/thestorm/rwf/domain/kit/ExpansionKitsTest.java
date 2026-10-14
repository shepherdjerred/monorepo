package com.shepherdjerred.thestorm.rwf.domain.kit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Set;
import org.junit.jupiter.api.Test;

/** Content boundaries of the eighteen additional paid kits and native ammunition. */
final class ExpansionKitsTest {
  @Test
  void expansionHasSixKitsPerCategoryAndPreservesTheSixPermanentFreeKits() {
    assertThat(ExpansionKits.ALL).hasSize(18);
    assertThat(KitBook.ALL).hasSize(51);
    assertThat(KitBook.ALL).extracting(KitSpec::id).doesNotHaveDuplicates();
    for (var category : KitCategory.values()) {
      assertThat(ExpansionKits.ALL.stream().filter(kit -> kit.category() == category)).hasSize(6);
    }
    assertThat(ExpansionKits.ALL).allMatch(KitSpec::purchasable);
    assertThat(KitBook.ALL.stream().filter(kit -> kit.price() == 0).map(KitSpec::id))
        .containsExactlyInAnyOrderElementsOf(
            Set.of("trooper", "longbow", "shortbow", "rewind", "medic", "teleporter"));
  }

  @Test
  void finiteFletcherArrowsKeepTheirNativePayloadAcrossItemCopies() {
    var arrows = ExpansionKits.FLETCHER.hotbar().get(2);
    assertThat(arrows.material()).isEqualTo("TIPPED_ARROW");
    assertThat(arrows.amount()).isEqualTo(8);
    assertThat(arrows.potions()).containsExactly(new ItemPotion("slowness", 0, 60));
    assertThat(arrows.times(1).named("copy").glinting().lore("gray", "Slows enemies").potions())
        .isEqualTo(arrows.potions());
    assertThat(ExpansionKits.FLETCHER.hotbar().get(1).enchantments()).doesNotContainKey("infinity");
    assertThatThrownBy(() -> ItemSpec.of("IRON_SWORD").potion("slowness", 0, 60))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new ItemPotion("slowness", 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void rangedWeaponsKeepDistinctNativeRulesInsteadOfGenericBowSubstitutions() {
    assertThat(ExpansionKits.ARBALIST.hotbar().get(1).enchantments())
        .containsEntry("quick_charge", 2)
        .containsEntry("piercing", 2);
    assertThat(ExpansionKits.VOLLEY.hotbar().get(1).enchantments())
        .containsEntry("multishot", 1)
        .doesNotContainKey("piercing");
    assertThat(ExpansionKits.HARPOONER.hotbar().get(1).enchantments())
        .containsOnlyKeys("loyalty")
        .containsEntry("loyalty", 3);
    assertThat(ExpansionKits.LANCER.hotbar().getFirst().material()).isEqualTo("IRON_SPEAR");
    assertThat(ExpansionKits.MACEGUARD.hotbar().getFirst().material()).isEqualTo("MACE");
  }
}
