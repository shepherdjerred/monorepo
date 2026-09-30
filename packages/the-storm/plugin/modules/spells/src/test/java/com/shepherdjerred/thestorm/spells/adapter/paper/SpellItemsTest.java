package com.shepherdjerred.thestorm.spells.adapter.paper;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.spells.app.SpellScrolls;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import io.papermc.paper.datacomponent.DataComponentTypes;
import java.util.UUID;
import net.kyori.adventure.key.Key;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

final class SpellItemsTest {

  private static final UUID ALICE = new UUID(0, 1);

  private final Harness harness = new Harness();
  private final SpellItems items = new SpellItems(harness.plugin, harness.config);

  @AfterEach
  void tearDown() {
    harness.close();
  }

  @Test
  void aFocusIsIdentifiedByItsSpellKeyOwnerAndGeneration() {
    var focus = items.focus(SpellKind.WALL, ALICE, 3);

    assertThat(items.identify(focus)).contains(new SpellIdentity.Focus(SpellKind.WALL, ALICE, 3));
    assertThat(
            focus
                .getPersistentDataContainer()
                .get(new NamespacedKey(harness.plugin, "spell"), PersistentDataType.STRING))
        .isEqualTo("wall");
    assertThat(items.spellOf(focus)).contains("wall");
  }

  @Test
  void aFocusCarriesItsLookAndCooldownGroupButIsNotConsumable() {
    var focus = items.focus(SpellKind.DAWN, ALICE, 1);

    assertThat(
            PlainTextComponentSerializer.plainText()
                .serialize(requireNonNull(focus.getData(DataComponentTypes.ITEM_NAME))))
        .isEqualTo("Dawn");
    assertThat(focus.getData(DataComponentTypes.ITEM_MODEL))
        .isEqualTo(Key.key("minecraft:sunflower"));
    var cooldown = requireNonNull(focus.getData(DataComponentTypes.USE_COOLDOWN));
    assertThat(cooldown.cooldownGroup()).isEqualTo(Key.key("thestorm", "spell/sky"));
    assertThat(cooldown.seconds()).isEqualTo(300f);
    assertThat(focus.hasData(DataComponentTypes.CONSUMABLE)).isFalse();
    assertThat(focus.getData(DataComponentTypes.MAX_STACK_SIZE)).isEqualTo(1);
  }

  @Test
  void dawnAndDuskItemsShareOneCooldownGroup() {
    var dawn =
        requireNonNull(
            items.focus(SpellKind.DAWN, ALICE, 1).getData(DataComponentTypes.USE_COOLDOWN));
    var dusk =
        requireNonNull(items.scrollOf(SpellKind.DUSK, 1).getData(DataComponentTypes.USE_COOLDOWN));

    assertThat(dawn.cooldownGroup()).isEqualTo(dusk.cooldownGroup());
  }

  @Test
  void aScrollIsConsumableStacksAndHasNoOwner() {
    var scrolls = items.scrollOf(SpellKind.BLINK, 5);

    assertThat(scrolls.getAmount()).isEqualTo(5);
    assertThat(items.identify(scrolls)).contains(new SpellIdentity.Scroll(SpellKind.BLINK));
    assertThat(scrolls.hasData(DataComponentTypes.CONSUMABLE)).isTrue();
    assertThat(scrolls.getData(DataComponentTypes.ITEM_MODEL))
        .isEqualTo(Key.key("minecraft:paper"));
    assertThat(scrolls.getData(DataComponentTypes.MAX_STACK_SIZE)).isEqualTo(16);
    assertThat(scrolls.isSimilar(items.scrollOf(SpellKind.BLINK, 1))).isTrue();
    assertThat(scrolls.isSimilar(items.scrollOf(SpellKind.CARPET, 1))).isFalse();
  }

  @Test
  void theScrollPortCreatesScrollsById() {
    SpellScrolls port = items;

    assertThat(port.scroll("carpet", 2).flatMap(port::spellOf)).contains("carpet");
    assertThat(port.scroll("fireball", 1)).isEmpty();
    assertThat(port.spellIds()).hasSize(SpellKind.values().length).contains("stormcall");
    assertThat(SpellScrolls.learnedPermission("blink")).isEqualTo("thestorm.spells.learned.blink");
  }

  @Test
  void scrollStacksAreBounded() {
    assertThatThrownBy(() -> items.scrollOf(SpellKind.MARK, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> items.scrollOf(SpellKind.MARK, 17))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void onlyTheKeyMakesASpellItem() {
    var lookalike = ItemStack.of(Material.PAPER);
    lookalike.setData(DataComponentTypes.ITEM_NAME, SpellItems.text("Wall"));
    lookalike.setData(DataComponentTypes.ITEM_MODEL, Key.key("minecraft:brick"));

    assertThat(items.identify(lookalike)).isEmpty();
    assertThat(items.identify(ItemStack.empty())).isEmpty();
  }

  @Test
  void aForgedSpellKeyIsABrokenInvariant() {
    var forged = ItemStack.of(Material.PAPER);
    forged.editPersistentDataContainer(
        pdc ->
            pdc.set(new NamespacedKey(harness.plugin, "spell"), PersistentDataType.STRING, "wall"));

    assertThatThrownBy(() -> items.identify(forged)).isInstanceOf(IllegalStateException.class);
  }
}
