package com.shepherdjerred.thestorm.shards.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.shards.domain.Bonuses;
import com.shepherdjerred.thestorm.shards.domain.ShardsConfig;
import com.shepherdjerred.thestorm.shards.domain.StormTier;
import java.nio.file.Path;
import java.util.Objects;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;

final class ShardItemsTest {

  private ServerMock server;
  private ShardItems shards;
  private StormGear gear;

  @BeforeEach
  void setUp() {
    server = MockBukkit.mock();
    var plugin = MockBukkit.createMockPlugin("TheStorm");
    var config =
        ConfigFiles.load(
            Path.of(Objects.requireNonNull(System.getProperty("thestorm.shards.config"))),
            ShardsConfig.class);
    var text = new ShardText(config.messages(), config.upgrades().loreLine());
    gear =
        new StormGear(
            new NamespacedKey(plugin, "storm_tier"),
            new NamespacedKey(plugin, "storm_gear"),
            new Bonuses(config.bonuses()),
            text);
    shards = new ShardItems(new NamespacedKey(plugin, "shard"), gear, config.item());
  }

  @AfterEach
  void tearDown() {
    MockBukkit.unmock();
  }

  @Test
  void shardsAreRecognisedByTheirKeyOnly() {
    var shard = shards.create(3);
    var plain = ItemStack.of(Material.PRISMARINE_SHARD, 3);

    assertThat(shard.getAmount()).isEqualTo(3);
    assertThat(shards.isShard(shard)).isTrue();
    assertThat(shards.isShard(plain)).isFalse();
    assertThat(shard.getPersistentDataContainer().getKeys())
        .contains(NamespacedKey.fromString("thestorm:shard"));
  }

  @Test
  void aRenamedPlainShardIsStillNotAShard() {
    var fake = ItemStack.of(Material.PRISMARINE_SHARD);
    fake.editMeta(meta -> meta.customName(ShardText.itemText("<dark_aqua>Storm Shard")));

    assertThat(shards.isShard(fake)).isFalse();
  }

  @Test
  void stackSizesAreBounded() {
    assertThatThrownBy(() -> shards.create(0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> shards.create(65)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void countsAndTakesAcrossStacks() {
    var player = server.addPlayer();
    var inventory = player.getInventory();
    inventory.setItem(0, shards.create(2));
    inventory.setItem(5, ItemStack.of(Material.PRISMARINE_SHARD, 10));
    inventory.setItem(9, shards.create(5));

    assertThat(shards.count(inventory)).isEqualTo(7);

    shards.take(inventory, 4);

    assertThat(shards.count(inventory)).isEqualTo(3);
    assertThat(inventory.getItem(5)).isEqualTo(ItemStack.of(Material.PRISMARINE_SHARD, 10));
  }

  @Test
  void takingMoreThanHeldIsABug() {
    var inventory = server.addPlayer().getInventory();
    inventory.setItem(0, shards.create(1));

    assertThatThrownBy(() -> shards.take(inventory, 2)).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void giveOverflowsIntoMoreStacks() {
    var player = server.addPlayer();

    shards.give(player, 70);

    assertThat(shards.count(player.getInventory())).isEqualTo(70);
  }

  @Test
  void tiersAreStoredInPersistentData() {
    var sword = ItemStack.of(Material.DIAMOND_SWORD);

    assertThat(gear.tierOf(sword)).isEmpty();
    assertThat(shards.stormTier(sword)).isEmpty();

    gear.apply(sword, new StormTier(3));

    assertThat(gear.tierOf(sword)).contains(new StormTier(3));
    assertThat(shards.stormTier(sword)).hasValue(3);
    assertThat(gear.pieceOf(sword)).isPresent();
  }

  @Test
  void upgradingReplacesTheStormLoreLine() {
    var sword = ItemStack.of(Material.DIAMOND_SWORD);

    gear.apply(sword, new StormTier(1));
    gear.apply(sword, new StormTier(2));

    var lore = Objects.requireNonNull(sword.lore());
    assertThat(lore).hasSize(1);
    assertThat(PlainTextComponentSerializer.plainText().serialize(lore.getFirst()))
        .isEqualTo("Storm II");
  }

  @Test
  void aCorruptTierFailsLoudly() {
    var sword = ItemStack.of(Material.DIAMOND_SWORD);
    sword.editPersistentDataContainer(
        pdc ->
            pdc.set(
                Objects.requireNonNull(NamespacedKey.fromString("thestorm:storm_tier")),
                PersistentDataType.INTEGER,
                9));

    assertThatThrownBy(() -> gear.tierOf(sword)).isInstanceOf(IllegalArgumentException.class);
  }
}
