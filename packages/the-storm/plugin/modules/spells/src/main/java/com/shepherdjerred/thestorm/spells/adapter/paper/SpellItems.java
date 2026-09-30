package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.spells.app.SpellScrolls;
import com.shepherdjerred.thestorm.spells.domain.RefusalText;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.ScrollConfig;
import com.shepherdjerred.thestorm.spells.domain.config.SpellEntry;
import com.shepherdjerred.thestorm.spells.domain.config.SpellsConfig;
import io.papermc.paper.datacomponent.DataComponentTypes;
import io.papermc.paper.datacomponent.item.Consumable;
import io.papermc.paper.datacomponent.item.ItemLore;
import io.papermc.paper.datacomponent.item.UseCooldown;
import io.papermc.paper.datacomponent.item.consumable.ItemUseAnimation;
import io.papermc.paper.persistence.PersistentDataContainerView;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import net.kyori.adventure.key.Key;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.minimessage.MiniMessage;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/**
 * Spell items. An item is a spell item only when it carries the {@code thestorm:spell} key (the
 * spell id); names, lore and models are presentation. A focus also records its owner and bind
 * generation; a scroll is consumable and stacks.
 *
 * <p>Every item carries a {@code use_cooldown} component in the spell's cooldown group, so the
 * client draws the native cooldown overlay on every item of that group.
 */
final class SpellItems implements SpellScrolls {

  static final String FOCUS = "focus";
  static final String SCROLL = "scroll";

  private static final Material BASE = Material.PAPER;
  private static final MiniMessage MINI = MiniMessage.miniMessage();

  private final NamespacedKey spellKey;
  private final NamespacedKey formKey;
  private final NamespacedKey ownerKey;
  private final NamespacedKey generationKey;
  private final SpellsConfig config;

  SpellItems(Plugin plugin, SpellsConfig config) {
    this.spellKey = new NamespacedKey(plugin, "spell");
    this.formKey = new NamespacedKey(plugin, "spell_form");
    this.ownerKey = new NamespacedKey(plugin, "spell_owner");
    this.generationKey = new NamespacedKey(plugin, "spell_generation");
    this.config = config;
  }

  /** The cooldown group key both the item component and {@code Player#setCooldown} use. */
  static Key cooldownGroup(String group) {
    return Key.key("thestorm", "spell/" + group);
  }

  /** A focus for {@code spell}, bound to {@code owner} at bind {@code generation}. */
  ItemStack focus(SpellKind spell, UUID owner, long generation) {
    var entry = config.spells().entry(spell);
    var item = base(spell, entry);
    item.setData(DataComponentTypes.ITEM_MODEL, Key.key(entry.look().model()));
    item.setData(DataComponentTypes.MAX_STACK_SIZE, 1);
    item.setData(DataComponentTypes.LORE, ItemLore.lore(focusLore(entry)));
    item.editPersistentDataContainer(
        pdc -> {
          pdc.set(formKey, PersistentDataType.STRING, FOCUS);
          pdc.set(ownerKey, PersistentDataType.STRING, owner.toString());
          pdc.set(generationKey, PersistentDataType.LONG, generation);
        });
    return item;
  }

  /** {@code amount} single-use scrolls of {@code spell}. */
  ItemStack scrollOf(SpellKind spell, int amount) {
    var scroll = config.scroll();
    if (amount < 1 || amount > scroll.maxStack()) {
      throw new IllegalArgumentException("scrolls stack 1.." + scroll.maxStack() + ": " + amount);
    }
    var entry = config.spells().entry(spell);
    var item = base(spell, entry);
    item.setData(DataComponentTypes.ITEM_MODEL, Key.key(scroll.model()));
    item.setData(DataComponentTypes.MAX_STACK_SIZE, scroll.maxStack());
    item.setData(DataComponentTypes.LORE, ItemLore.lore(scrollLore(entry)));
    item.setData(DataComponentTypes.CONSUMABLE, consumable(scroll));
    item.editPersistentDataContainer(pdc -> pdc.set(formKey, PersistentDataType.STRING, SCROLL));
    item.setAmount(amount);
    return item;
  }

  private ItemStack base(SpellKind spell, SpellEntry<?> entry) {
    var item = ItemStack.of(BASE);
    item.setData(DataComponentTypes.ITEM_NAME, text(entry.look().name()));
    item.setData(
        DataComponentTypes.USE_COOLDOWN,
        UseCooldown.useCooldown(entry.cooldownSeconds())
            .cooldownGroup(cooldownGroup(entry.cooldownGroup()))
            .build());
    item.setData(DataComponentTypes.ENCHANTMENT_GLINT_OVERRIDE, true);
    item.editPersistentDataContainer(
        pdc -> pdc.set(spellKey, PersistentDataType.STRING, spell.id()));
    return item;
  }

  private static Consumable consumable(ScrollConfig scroll) {
    return Consumable.consumable()
        .consumeSeconds((float) scroll.readSeconds())
        .animation(ItemUseAnimation.TOOT_HORN)
        .sound(Key.key(Key.MINECRAFT_NAMESPACE, scroll.sound()))
        .hasConsumeParticles(false)
        .build();
  }

  private static List<Component> focusLore(SpellEntry<?> entry) {
    var lines = flavor(entry);
    lines.add(Component.empty());
    lines.add(
        label(
            "Spellcaster "
                + RefusalText.roman(entry.tier())
                + (entry.learned() ? " · learned in a quest" : "")));
    lines.add(
        label(
            entry.reagents().isEmpty()
                ? "Costs nothing"
                : "Costs " + RefusalText.reagents(entry.reagents())));
    lines.add(label("Cooldown " + RefusalText.seconds(entry.cooldown())));
    return lines;
  }

  private static List<Component> scrollLore(SpellEntry<?> entry) {
    var lines = flavor(entry);
    lines.add(Component.empty());
    lines.add(label("Single-use scroll · read to cast"));
    return lines;
  }

  private static List<Component> flavor(SpellEntry<?> entry) {
    var lines = new ArrayList<Component>();
    for (var line : entry.look().lore()) {
      lines.add(text(line));
    }
    return lines;
  }

  private static Component label(String text) {
    return Component.text(text, NamedTextColor.DARK_GRAY).decoration(TextDecoration.ITALIC, false);
  }

  /** MiniMessage content without the lore's default italics. */
  static Component text(String miniMessage) {
    return MINI.deserialize(miniMessage)
        .decorationIfAbsent(TextDecoration.ITALIC, TextDecoration.State.FALSE);
  }

  /** What {@code item} is, when it is a spell item. */
  Optional<SpellIdentity> identify(ItemStack item) {
    if (item.isEmpty()) {
      return Optional.empty();
    }
    var pdc = item.getPersistentDataContainer();
    var id = pdc.get(spellKey, PersistentDataType.STRING);
    if (id == null) {
      return Optional.empty();
    }
    var spell =
        SpellKind.byId(id)
            .orElseThrow(() -> new IllegalStateException("spell item names unknown spell " + id));
    var form = pdc.get(formKey, PersistentDataType.STRING);
    if (SCROLL.equals(form)) {
      return Optional.of(new SpellIdentity.Scroll(spell));
    }
    if (FOCUS.equals(form)) {
      return Optional.of(focusIdentity(spell, pdc));
    }
    throw new IllegalStateException("spell item " + id + " has unknown form " + form);
  }

  private SpellIdentity focusIdentity(SpellKind spell, PersistentDataContainerView pdc) {
    var owner = pdc.get(ownerKey, PersistentDataType.STRING);
    var generation = pdc.get(generationKey, PersistentDataType.LONG);
    if (owner == null || generation == null) {
      throw new IllegalStateException("focus for " + spell.id() + " lacks its owner or generation");
    }
    return new SpellIdentity.Focus(spell, UUID.fromString(owner), generation);
  }

  @Override
  public Set<String> spellIds() {
    return Arrays.stream(SpellKind.values())
        .map(SpellKind::id)
        .collect(Collectors.toUnmodifiableSet());
  }

  @Override
  public Optional<ItemStack> scroll(String spellId, int amount) {
    return SpellKind.byId(spellId).map(spell -> scrollOf(spell, amount));
  }

  @Override
  public Optional<String> spellOf(ItemStack item) {
    return identify(item).map(identity -> identity.spell().id());
  }
}
