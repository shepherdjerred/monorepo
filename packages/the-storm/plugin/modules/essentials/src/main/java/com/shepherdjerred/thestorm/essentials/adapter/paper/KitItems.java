package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.essentials.domain.config.KitSettings;
import com.shepherdjerred.thestorm.essentials.domain.kit.BookContent;
import com.shepherdjerred.thestorm.essentials.domain.kit.Kit;
import com.shepherdjerred.thestorm.essentials.domain.kit.KitItem;
import io.papermc.paper.datacomponent.DataComponentTypes;
import io.papermc.paper.datacomponent.item.WrittenBookContent;
import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import net.kyori.adventure.inventory.Book;
import net.kyori.adventure.key.Key;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.minimessage.MiniMessage;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

/**
 * Kits turned into item stacks once, at enable, so a bad material or enchantment stops the module
 * instead of failing when a player claims the kit.
 */
final class KitItems {

  private static final MiniMessage MINI = MiniMessage.miniMessage();

  private final Map<String, List<ItemStack>> templates;

  private KitItems(Map<String, List<ItemStack>> templates) {
    this.templates = Map.copyOf(templates);
  }

  /** Builds every kit, or throws naming every material or enchantment the server does not know. */
  static KitItems build(KitSettings settings) {
    var problems = new ArrayList<String>();
    var templates = new TreeMap<String, List<ItemStack>>();
    for (var entry : settings.kits().entrySet()) {
      templates.put(entry.getKey(), stacks(entry.getKey(), entry.getValue(), problems));
    }
    if (!problems.isEmpty()) {
      throw new IllegalStateException(
          "Invalid kits in essentials.yml: " + String.join("; ", problems));
    }
    return new KitItems(templates);
  }

  /** Gives {@code player} the kit called {@code name}, dropping what does not fit at their feet. */
  void give(Player player, String name) {
    var stacks = templates.get(name);
    if (stacks == null) {
      throw new IllegalArgumentException("unknown kit " + name);
    }
    var copies = stacks.stream().map(ItemStack::clone).toArray(ItemStack[]::new);
    var leftovers = player.getInventory().addItem(copies);
    leftovers
        .values()
        .forEach(item -> player.getWorld().dropItemNaturally(Positions.current(player), item));
  }

  /** A written book item. */
  static ItemStack book(BookContent content) {
    var item = ItemStack.of(Material.WRITTEN_BOOK);
    item.setData(
        DataComponentTypes.WRITTEN_BOOK_CONTENT,
        WrittenBookContent.writtenBookContent(content.title(), content.author())
            .addPages(pages(content))
            .build());
    return item;
  }

  /** A book to open with {@code player.openBook}, for {@code /rules}. */
  static Book readable(BookContent content) {
    return Book.book(
        Component.text(content.title()), Component.text(content.author()), pages(content));
  }

  private static List<Component> pages(BookContent content) {
    return content.pages().stream().map(MINI::deserialize).toList();
  }

  private static List<ItemStack> stacks(String kitName, Kit kit, List<String> problems) {
    var stacks = new ArrayList<ItemStack>();
    for (var item : kit.items()) {
      var material = Material.matchMaterial(item.material());
      if (material == null || !material.isItem()) {
        problems.add("kit " + kitName + ": " + item.material() + " is not an item");
        continue;
      }
      stacks.add(stack(kitName, material, item, problems));
    }
    kit.books().forEach(book -> stacks.add(book(book)));
    return List.copyOf(stacks);
  }

  private static ItemStack stack(
      String kitName, Material material, KitItem item, List<String> problems) {
    var stack = ItemStack.of(material, item.amount());
    item.name()
        .ifPresent(
            name ->
                stack.setData(
                    DataComponentTypes.CUSTOM_NAME,
                    MINI.deserialize(name)
                        .decorationIfAbsent(TextDecoration.ITALIC, TextDecoration.State.FALSE)));
    var enchantments = RegistryAccess.registryAccess().getRegistry(RegistryKey.ENCHANTMENT);
    item.enchantments()
        .forEach(
            (key, level) -> {
              var enchantment = enchantments.get(Key.key(key));
              if (enchantment == null) {
                problems.add("kit " + kitName + ": unknown enchantment " + key);
              } else {
                stack.addUnsafeEnchantment(enchantment, level);
              }
            });
    return stack;
  }
}
