package com.shepherdjerred.thestorm.shards.domain;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Combat math for upgraded gear. Bonuses are percentages of the damage vanilla already computed
 * (after the attack-cooldown charge, critical hits, the mace's smash and enchantments), so a
 * half-charged swing gets half the benefit. Against players every bonus is scaled by the PvP
 * multiplier; armor reduction is summed over the worn pieces and capped.
 */
public final class Bonuses {

  private final BonusConfig config;
  private final Map<GearCategory, GearTable> tables;
  private final Map<String, GearCategory> categories;

  public Bonuses(BonusConfig config) {
    this.config = config;
    this.tables = config.tables();
    var byMaterial = new HashMap<String, GearCategory>();
    tables.forEach(
        (category, table) -> table.materials().forEach(m -> byMaterial.put(m, category)));
    this.categories = Map.copyOf(byMaterial);
  }

  /** The gear category of an item material, or empty when the altar cannot upgrade it. */
  public Optional<GearCategory> categoryOf(String material) {
    return Optional.ofNullable(categories.get(material));
  }

  /** The configured bonus fraction of {@code piece}, before any PvP scaling. */
  public double bonus(StormPiece piece) {
    return table(piece.category()).at(piece.tier());
  }

  /** The bonus fraction of {@code piece} against {@code opponent}. */
  public double bonusAgainst(StormPiece piece, Opponent opponent) {
    return bonus(piece) * scale(opponent);
  }

  /**
   * The factor applied to damage dealt by a hit with {@code weapon}: {@code 1 + bonus}, or exactly
   * 1 when the gear does not boost this kind of attack (armor, or a bow swung in melee).
   */
  public double damageDealtMultiplier(StormPiece weapon, Attack attack, Opponent opponent) {
    if (!weapon.category().boosts(attack)) {
      return 1;
    }
    return 1 + bonusAgainst(weapon, opponent);
  }

  /**
   * The factor applied to damage taken by a player wearing {@code worn}: {@code 1 - reduction},
   * where the reduction is the sum over armor pieces, capped at {@code maxTotalReduction}, then
   * scaled for PvP. Environmental damage (no attacker) is never reduced.
   */
  public double damageTakenMultiplier(Collection<StormPiece> worn, Opponent opponent) {
    if (opponent == Opponent.ENVIRONMENT) {
      return 1;
    }
    return 1 - totalReduction(worn) * scale(opponent);
  }

  /** The capped reduction of {@code worn} against mobs. */
  public double totalReduction(Collection<StormPiece> worn) {
    var sum =
        worn.stream().filter(piece -> piece.category().isArmor()).mapToDouble(this::bonus).sum();
    return Math.min(sum, config.maxTotalReduction());
  }

  private double scale(Opponent opponent) {
    return switch (opponent) {
      case PLAYER -> config.pvpMultiplier();
      case MOB, ENVIRONMENT -> 1;
    };
  }

  private GearTable table(GearCategory category) {
    var table = tables.get(category);
    if (table == null) {
      throw new IllegalStateException("no bonus table for " + category);
    }
    return table;
  }
}
