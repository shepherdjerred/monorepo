package com.shepherdjerred.thestorm.shards.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

final class ShardsConfigTest {

  private static Path shipped() {
    var path = System.getProperty("thestorm.shards.config");
    assertThat(path).as("the build passes the shipped shards.yml path").isNotNull();
    return Path.of(path);
  }

  private static ShardsConfig load() {
    return ConfigFiles.load(shipped(), ShardsConfig.class);
  }

  @Test
  void theShippedFileParses() {
    var config = load();

    assertThat(config.item().material()).isEqualTo("PRISMARINE_SHARD");
    assertThat(config.altars())
        .first()
        .isEqualTo(new AltarLocation("minecraft:overworld", -71, 74, -243, "EMERALD_BLOCK"));
    assertThat(config.upgrades().tiers())
        .extracting(TierRule::cost)
        .containsExactly(1, 2, 4, 6, 10);
    assertThat(config.upgrades().tiers()).allMatch(rule -> rule.breakChance() == 0);
    assertThat(config.upgrades().broadcastFromTier()).isEqualTo(3);
    assertThat(config.upgrades().attemptCooldownMillis()).isEqualTo(1000);
    assertThat(config.bonuses().pvpMultiplier()).isEqualTo(0.4);
  }

  @Test
  void theShippedDropTablesKeepTheV4OreOdds() {
    var blocks = load().drops().blocks();

    assertThat(blocks.get("EMERALD_ORE")).isEqualTo(new DropRule(0.01, 1, 2));
    assertThat(blocks.get("DEEPSLATE_EMERALD_ORE")).isEqualTo(new DropRule(0.01, 1, 2));
    assertThat(blocks.get("DIAMOND_ORE")).isEqualTo(new DropRule(0.0075, 1, 2));
    assertThat(blocks.get("DEEPSLATE_DIAMOND_ORE")).isEqualTo(new DropRule(0.0075, 1, 2));
    assertThat(blocks).doesNotContainKeys("STONE", "OBSIDIAN");
  }

  @Test
  void theShippedMobTablesUseBossesAndModernMobs() {
    var mobs = load().drops().mobs();

    assertThat(mobs).containsKeys("WARDEN", "WITHER", "ENDER_DRAGON", "BREEZE", "RAVAGER");
    assertThat(mobs).containsKeys("EVOKER", "PIGLIN_BRUTE");
    assertThat(mobs).containsEntry("ZOMBIE", new DropRule(0.0005, 1, 1));
    assertThat(mobs).containsEntry("WITCH", new DropRule(0.0005, 1, 1));
    assertThat(mobs).containsEntry("GHAST", new DropRule(0.001, 1, 1));
    assertThat(mobs).containsEntry("ENDERMAN", new DropRule(0.0001, 1, 1));
    assertThat(mobs).doesNotContainKeys("GIANT", "PIG_ZOMBIE");
  }

  @Test
  void theShippedExclusionsBlockSpawnerFarmsButNotTrialChambers() {
    var excluded = load().drops().excludedSpawnReasons();

    assertThat(excluded).contains("RAID", "SPAWNER", "SPAWNER_EGG").doesNotContain("TRIAL_SPAWNER");
  }

  @Test
  void theShippedGearCoversModernWeapons() {
    var bonuses = new Bonuses(load().bonuses());

    assertThat(bonuses.categoryOf("MACE")).contains(GearCategory.MACE);
    assertThat(bonuses.categoryOf("NETHERITE_SPEAR")).contains(GearCategory.SPEAR);
    assertThat(bonuses.categoryOf("COPPER_SWORD")).contains(GearCategory.SWORD);
    assertThat(bonuses.categoryOf("CROSSBOW")).contains(GearCategory.CROSSBOW);
    assertThat(bonuses.categoryOf("TURTLE_HELMET")).contains(GearCategory.HELMET);
    assertThat(bonuses.categoryOf("DIAMOND_PICKAXE")).isEmpty();
  }

  @Test
  void theShippedArmorCapBindsOnAFullStormFiveSet() {
    var bonuses = new Bonuses(load().bonuses());
    var fullSet =
        List.of(
            new StormPiece(GearCategory.HELMET, new StormTier(5)),
            new StormPiece(GearCategory.CHESTPLATE, new StormTier(5)),
            new StormPiece(GearCategory.LEGGINGS, new StormTier(5)),
            new StormPiece(GearCategory.BOOTS, new StormTier(5)));

    assertThat(bonuses.totalReduction(fullSet)).isEqualTo(0.2);
  }

  @Test
  void anUnknownKeyIsRejected() throws IOException {
    var yaml = Files.readString(shipped()) + "surprise: true\n";

    assertThat(StrictYaml.parse("shards.yml", yaml, ShardsConfig.class).isOk()).isFalse();
  }

  @Test
  void aMissingTierIsRejected() throws IOException {
    var yaml =
        Files.readString(shipped())
            .replace("    - { cost: 10, failChance: 0.3, breakChance: 0.0 }\n", "");

    assertThat(StrictYaml.parse("shards.yml", yaml, ShardsConfig.class).isOk()).isFalse();
  }

  @Test
  void aMissingMessageIsRejected() throws IOException {
    var yaml =
        Files.readString(shipped())
            .lines()
            .filter(line -> !line.startsWith("  noStorm:"))
            .reduce("", (text, line) -> text + line + "\n");

    assertThat(StrictYaml.parse("shards.yml", yaml, ShardsConfig.class).isOk()).isFalse();
  }

  @Test
  void messagesRequireTheirPlaceholders() {
    var messages = load().messages();

    assertThatThrownBy(
            () ->
                new ShardMessages(
                    "You found a shard.",
                    messages.noStorm(),
                    messages.notUpgradeable(),
                    messages.atMaxTier(),
                    messages.notEnoughShards(),
                    messages.upgraded(),
                    messages.failed(),
                    messages.shattered(),
                    messages.broadcast(),
                    messages.infoUnupgraded(),
                    messages.infoWeapon(),
                    messages.infoArmor(),
                    messages.infoNotUpgradeable(),
                    messages.given(),
                    messages.received(),
                    messages.help()))
        .hasMessageContaining("messages.found must contain <amount>");
  }

  @Test
  void theShardItemNeedsAModelKey() {
    assertThatThrownBy(
            () -> new ShardItemConfig("PRISMARINE_SHARD", "Storm Shard", List.of(), "shard", true))
        .hasMessageContaining("item.itemModel");
  }

  @Test
  void altarsMustBeListedOnce() {
    var config = load();
    var windmill = config.altars().getFirst();

    assertThatThrownBy(
            () ->
                new ShardsConfig(
                    config.item(),
                    config.drops(),
                    config.upgrades(),
                    List.of(),
                    config.bonuses(),
                    config.messages()))
        .hasMessageContaining("altars");
    assertThatThrownBy(
            () ->
                new ShardsConfig(
                    config.item(),
                    config.drops(),
                    config.upgrades(),
                    List.of(windmill, windmill),
                    config.bonuses(),
                    config.messages()))
        .hasMessageContaining("repeat");
  }
}
