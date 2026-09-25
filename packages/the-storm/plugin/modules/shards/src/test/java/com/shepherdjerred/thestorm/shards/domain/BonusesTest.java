package com.shepherdjerred.thestorm.shards.domain;

import static com.shepherdjerred.thestorm.shards.domain.Fixtures.WEAPON;
import static com.shepherdjerred.thestorm.shards.domain.Fixtures.table;
import static com.shepherdjerred.thestorm.shards.domain.Fixtures.tier;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;

final class BonusesTest {

  private static final double EPSILON = 1e-9;

  private final Bonuses bonuses = new Bonuses(Fixtures.bonuses());

  private static StormPiece piece(GearCategory category, int level) {
    return new StormPiece(category, tier(level));
  }

  @ParameterizedTest
  @CsvSource({
    "IRON_SWORD,SWORD",
    "NETHERITE_SWORD,SWORD",
    "IRON_AXE,AXE",
    "MACE,MACE",
    "IRON_SPEAR,SPEAR",
    "TRIDENT,TRIDENT",
    "BOW,BOW",
    "CROSSBOW,CROSSBOW",
    "IRON_HELMET,HELMET",
    "IRON_CHESTPLATE,CHESTPLATE",
    "IRON_LEGGINGS,LEGGINGS",
    "IRON_BOOTS,BOOTS"
  })
  void everyCategoryIsEligible(String material, GearCategory category) {
    assertThat(bonuses.categoryOf(material)).contains(category);
  }

  @ParameterizedTest
  @CsvSource({"DIAMOND_PICKAXE", "SHIELD", "ELYTRA", "FISHING_ROD", "PRISMARINE_SHARD"})
  void otherItemsAreNotEligible(String material) {
    assertThat(bonuses.categoryOf(material)).isEmpty();
  }

  @ParameterizedTest
  @CsvSource({"1,1.05", "2,1.10", "3,1.15", "4,1.20", "5,1.25"})
  void swordsDealTheirTierBonusAgainstMobs(int level, double multiplier) {
    assertThat(
            bonuses.damageDealtMultiplier(
                piece(GearCategory.SWORD, level), Attack.MELEE, Opponent.MOB))
        .isCloseTo(multiplier, within(EPSILON));
  }

  @Test
  void playersFaceOnlyThePvpShareOfTheBonus() {
    // Storm V sword: +25% against mobs, 40% of that (+10%) against players.
    var sword = piece(GearCategory.SWORD, 5);

    assertThat(bonuses.damageDealtMultiplier(sword, Attack.MELEE, Opponent.PLAYER))
        .isCloseTo(1.10, within(EPSILON));
    assertThat(bonuses.bonusAgainst(sword, Opponent.MOB)).isCloseTo(0.25, within(EPSILON));
    assertThat(bonuses.bonusAgainst(sword, Opponent.PLAYER)).isCloseTo(0.10, within(EPSILON));
  }

  @Test
  void theMaceHasItsOwnSmallerTable() {
    assertThat(
            bonuses.damageDealtMultiplier(piece(GearCategory.MACE, 5), Attack.MELEE, Opponent.MOB))
        .isCloseTo(1.15, within(EPSILON));
  }

  @Test
  void bowsBoostArrowsButNotSwings() {
    var bow = piece(GearCategory.BOW, 3);

    assertThat(bonuses.damageDealtMultiplier(bow, Attack.PROJECTILE, Opponent.MOB))
        .isCloseTo(1.15, within(EPSILON));
    assertThat(bonuses.damageDealtMultiplier(bow, Attack.MELEE, Opponent.MOB)).isEqualTo(1);
  }

  @Test
  void swordsDoNotBoostProjectiles() {
    assertThat(
            bonuses.damageDealtMultiplier(
                piece(GearCategory.SWORD, 5), Attack.PROJECTILE, Opponent.MOB))
        .isEqualTo(1);
  }

  @Test
  void tridentsBoostBothThrowsAndStabs() {
    var trident = piece(GearCategory.TRIDENT, 2);

    assertThat(bonuses.damageDealtMultiplier(trident, Attack.MELEE, Opponent.MOB))
        .isCloseTo(1.10, within(EPSILON));
    assertThat(bonuses.damageDealtMultiplier(trident, Attack.PROJECTILE, Opponent.MOB))
        .isCloseTo(1.10, within(EPSILON));
  }

  @Test
  void armorInHandDealsNoBonus() {
    assertThat(
            bonuses.damageDealtMultiplier(
                piece(GearCategory.CHESTPLATE, 5), Attack.MELEE, Opponent.MOB))
        .isEqualTo(1);
  }

  @Test
  void armorReductionSumsAcrossPieces() {
    var worn = List.of(piece(GearCategory.HELMET, 1), piece(GearCategory.CHESTPLATE, 2));

    // 1% + 4%
    assertThat(bonuses.damageTakenMultiplier(worn, Opponent.MOB)).isCloseTo(0.95, within(EPSILON));
  }

  @Test
  void aFullStormFiveSetIsCapped() {
    var worn =
        List.of(
            piece(GearCategory.HELMET, 5),
            piece(GearCategory.CHESTPLATE, 5),
            piece(GearCategory.LEGGINGS, 5),
            piece(GearCategory.BOOTS, 5));

    // 5 + 7 + 6 + 5 = 23%, capped at 20%.
    assertThat(bonuses.totalReduction(worn)).isCloseTo(0.20, within(EPSILON));
    assertThat(bonuses.damageTakenMultiplier(worn, Opponent.MOB)).isCloseTo(0.80, within(EPSILON));
  }

  @Test
  void thePvpShareAppliesAfterTheCap() {
    var worn =
        List.of(
            piece(GearCategory.HELMET, 5),
            piece(GearCategory.CHESTPLATE, 5),
            piece(GearCategory.LEGGINGS, 5),
            piece(GearCategory.BOOTS, 5));

    // 20% cap x 0.4 = 8%.
    assertThat(bonuses.damageTakenMultiplier(worn, Opponent.PLAYER))
        .isCloseTo(0.92, within(EPSILON));
  }

  @Test
  void environmentalDamageIsNeverReduced() {
    var worn = List.of(piece(GearCategory.CHESTPLATE, 5));

    assertThat(bonuses.damageTakenMultiplier(worn, Opponent.ENVIRONMENT)).isEqualTo(1);
  }

  @Test
  void weaponsDoNotCountAsArmor() {
    var worn = List.of(piece(GearCategory.SWORD, 5), piece(GearCategory.BOOTS, 1));

    assertThat(bonuses.totalReduction(worn)).isCloseTo(0.01, within(EPSILON));
  }

  @Test
  void noArmorMeansNoReduction() {
    assertThat(bonuses.damageTakenMultiplier(List.of(), Opponent.MOB)).isEqualTo(1);
  }

  @ParameterizedTest
  @EnumSource(GearCategory.class)
  void everyCategoryIsExactlyOneOfMeleeRangedOrArmor(GearCategory category) {
    var melee = category.boosts(Attack.MELEE);
    var ranged = category.boosts(Attack.PROJECTILE);
    assertThat(category.isArmor()).isEqualTo(!melee && !ranged);
  }

  @Test
  void gearTablesValidateThemselves() {
    assertThatThrownBy(() -> table(WEAPON)).hasMessageContaining("materials");
    assertThatThrownBy(() -> table(WEAPON, "IRON_SWORD", "IRON_SWORD"))
        .hasMessageContaining("repeat");
    assertThatThrownBy(() -> table(WEAPON, "iron_sword")).hasMessageContaining("upper-case");
    assertThatThrownBy(() -> table(List.of(0.1, 0.2), "IRON_SWORD"))
        .hasMessageContaining("one entry per tier");
    assertThatThrownBy(() -> table(List.of(0.1, 0.2, 0.15, 0.3, 0.4), "IRON_SWORD"))
        .hasMessageContaining("decrease");
    assertThatThrownBy(() -> table(List.of(0.1, 0.2, 0.3, 0.4, 1.5), "IRON_SWORD"))
        .hasMessageContaining("between 0 and 1");
  }

  @Test
  void bonusConfigRejectsAMaterialInTwoCategories() {
    var config = Fixtures.bonuses();
    var weapons = config.weapons();
    var clash =
        new WeaponTables(
            weapons.sword(),
            table(WEAPON, "IRON_AXE", "IRON_SWORD"),
            weapons.mace(),
            weapons.spear(),
            weapons.trident(),
            weapons.bow(),
            weapons.crossbow());

    assertThatThrownBy(() -> new BonusConfig(0.4, 0.2, clash, config.armor()))
        .hasMessageContaining("IRON_SWORD is listed under both");
  }

  @Test
  void bonusConfigRejectsImmortality() {
    var config = Fixtures.bonuses();

    assertThatThrownBy(() -> new BonusConfig(0.4, 1.0, config.weapons(), config.armor()))
        .hasMessageContaining("below 1");
    assertThatThrownBy(() -> new BonusConfig(1.2, 0.2, config.weapons(), config.armor()))
        .hasMessageContaining("pvpMultiplier");
  }

  @Test
  void everyCategoryHasATable() {
    assertThat(Fixtures.bonuses().tables()).containsOnlyKeys(GearCategory.values());
  }
}
