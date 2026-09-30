package com.shepherdjerred.thestorm.shards.domain;

import java.util.List;

/**
 * Player-facing text, in MiniMessage. Each template must contain the placeholders listed here.
 *
 * @param found a shard dropped for the player: {@code <amount>}
 * @param noStorm the altar was used in clear weather
 * @param notUpgradeable the held item cannot be upgraded
 * @param atMaxTier the held item is already Storm V
 * @param notEnoughShards too few shards: {@code <tier>}, {@code <needed>}, {@code <held>}
 * @param upgraded success: {@code <item>}, {@code <tier>}
 * @param failed shards spent, item unchanged: {@code <item>}, {@code <tier>}
 * @param shattered the item was destroyed: {@code <item>}, {@code <tier>}
 * @param broadcast the server-wide announcement: {@code <player>}, {@code <item>}, {@code <tier>}
 * @param infoUnupgraded {@code /shards info} on eligible gear without a tier: {@code <cost>}
 * @param infoWeapon {@code /shards info} on an upgraded weapon: {@code <tier>}, {@code <pve>},
 *     {@code <pvp>}
 * @param infoArmor {@code /shards info} on upgraded armor: {@code <tier>}, {@code <pve>}, {@code
 *     <pvp>}
 * @param infoNotUpgradeable {@code /shards info} on anything else
 * @param given confirmation for {@code /shards give}: {@code <amount>}, {@code <player>}
 * @param received the recipient of {@code /shards give}: {@code <amount>}
 * @param help lines shown by {@code /shards}
 */
public record ShardMessages(
    String found,
    String noStorm,
    String notUpgradeable,
    String atMaxTier,
    String notEnoughShards,
    String upgraded,
    String failed,
    String shattered,
    String broadcast,
    String infoUnupgraded,
    String infoWeapon,
    String infoArmor,
    String infoNotUpgradeable,
    String given,
    String received,
    List<String> help) {

  public ShardMessages {
    help = List.copyOf(help);
    Checks.template("messages.found", found, "amount");
    Checks.template("messages.noStorm", noStorm);
    Checks.template("messages.notUpgradeable", notUpgradeable);
    Checks.template("messages.atMaxTier", atMaxTier);
    Checks.template("messages.notEnoughShards", notEnoughShards, "tier", "needed", "held");
    Checks.template("messages.upgraded", upgraded, "item", "tier");
    Checks.template("messages.failed", failed, "item", "tier");
    Checks.template("messages.shattered", shattered, "item", "tier");
    Checks.template("messages.broadcast", broadcast, "player", "item", "tier");
    Checks.template("messages.infoUnupgraded", infoUnupgraded, "cost");
    Checks.template("messages.infoWeapon", infoWeapon, "tier", "pve", "pvp");
    Checks.template("messages.infoArmor", infoArmor, "tier", "pve", "pvp");
    Checks.template("messages.infoNotUpgradeable", infoNotUpgradeable);
    Checks.template("messages.given", given, "amount", "player");
    Checks.template("messages.received", received, "amount");
    Checks.notEmpty("messages.help", help);
  }
}
