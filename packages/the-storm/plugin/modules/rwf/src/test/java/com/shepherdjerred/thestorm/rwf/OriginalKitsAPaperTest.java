package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.util.List;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.inventory.ItemFlag;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Batch A's kit items on MockBukkit as Red Warfare built them: titles, the fuse's lore laid out by
 * its splitLine, which items are unbreakable, and the item flags its ItemBuilder and {@code
 * Kit.giveItems} left on each.
 */
final class OriginalKitsAPaperTest {

  @TempDir Path directory;
  private @Nullable KitFight fight;

  @AfterEach
  void stop() {
    if (fight != null) {
      fight.close();
    }
  }

  private KitFight on(String kit) {
    fight = KitFight.on(directory, kit);
    return fight;
  }

  private static ItemStack slot(KitFight fight, int slot) {
    return requireNonNull(fight.alice.getInventory().getItem(slot));
  }

  @Test
  void theFuseIsGoldAndItsLoreBreaksAsRedWarfaresDid() {
    var fuse = slot(on("trooper"), 0);

    assertThat(fuse.getItemMeta().displayName())
        .isEqualTo(
            Component.text("Bomb Fuse", NamedTextColor.GOLD)
                .decoration(TextDecoration.ITALIC, false));
    var lore = requireNonNull(fuse.lore());
    assertThat(lore)
        .extracting(PlainTextComponentSerializer.plainText()::serialize)
        .containsExactly("RIGHT CLICK BOMB TO", "ARM AND DISARM");
    assertThat(lore)
        .extracting(LegacyComponentSerializer.legacySection()::serialize)
        .containsExactly("§d§lRIGHT CLICK BOMB TO", "§d§lARM AND DISARM");
  }

  @Test
  void weaponsShowUnbreakableButHideAttributesAndBowsTheReverse() {
    var trooper = on("trooper");
    var sword = slot(trooper, 1);

    assertThat(sword.getItemMeta().isUnbreakable()).isTrue();
    assertThat(sword.getItemMeta().getItemFlags()).containsExactly(ItemFlag.HIDE_ATTRIBUTES);
    assertThat(slot(trooper, 2).getItemMeta().getItemFlags())
        .as("golden apples were a plain ItemStack")
        .isEmpty();
    var chest = requireNonNull(trooper.alice.getInventory().getChestplate());
    assertThat(chest.getItemMeta().isUnbreakable()).isTrue();
    assertThat(chest.getItemMeta().getItemFlags()).as("plain armour kept no flags").isEmpty();
  }

  @Test
  void aBowHidesOnlyItsUnbreakableLine() {
    var bow = slot(on("longbow"), 2);

    assertThat(bow.getItemMeta().isUnbreakable()).isTrue();
    assertThat(bow.getItemMeta().getItemFlags()).containsExactly(ItemFlag.HIDE_UNBREAKABLE);
  }

  @Test
  void theMedicsWandHasTheOriginalsBareGoldTitle() {
    var wand = slot(on("medic"), 2);

    assertThat(wand.getItemMeta().displayName())
        .isEqualTo(
            Component.text("", NamedTextColor.GOLD).decoration(TextDecoration.ITALIC, false));
  }

  @Test
  void builtArmourHidesEverythingButEnchantments() {
    var boots = requireNonNull(on("frost").alice.getInventory().getBoots());

    assertThat(boots.getItemMeta().getItemFlags())
        .contains(ItemFlag.HIDE_ATTRIBUTES, ItemFlag.HIDE_UNBREAKABLE)
        .doesNotContain(ItemFlag.HIDE_ENCHANTS, ItemFlag.HIDE_DYE);
  }

  @Test
  void theVenomsSwordLoreKeepsItsGap() {
    var sword = slot(on("venom"), 1);

    assertThat(requireNonNull(sword.lore()))
        .extracting(PlainTextComponentSerializer.plainText()::serialize)
        .isEqualTo(List.of("", "Venom I"));
  }
}
