package com.shepherdjerred.thestorm.quests.adapter.paper;

import com.shepherdjerred.thestorm.quests.domain.model.ItemFacts;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.EnchantmentStorageMeta;
import org.bukkit.inventory.meta.PotionMeta;

/** Item stacks as quests see them: reading facts, counting, taking and making items. */
final class ItemStacks {

  private ItemStacks() {}

  /** What {@code stack} is. Enchanted books count their stored enchantments. */
  static ItemFacts facts(ItemStack stack) {
    var enchantments = new HashMap<String, Integer>();
    var registry = RegistryAccess.registryAccess().getRegistry(RegistryKey.ENCHANTMENT);
    stack
        .getEnchantments()
        .forEach(
            (enchantment, level) ->
                enchantments.put(registry.getKeyOrThrow(enchantment).getKey(), level));
    Optional<String> name = Optional.empty();
    Optional<String> potion = Optional.empty();
    var meta = stack.getItemMeta();
    if (meta != null) {
      var custom = meta.customName();
      if (custom != null) {
        name = Optional.of(PlainTextComponentSerializer.plainText().serialize(custom));
      }
      if (meta instanceof EnchantmentStorageMeta stored) {
        stored
            .getStoredEnchants()
            .forEach(
                (enchantment, level) ->
                    enchantments.merge(
                        registry.getKeyOrThrow(enchantment).getKey(), level, Math::max));
      }
      if (meta instanceof PotionMeta potionMeta && potionMeta.hasBasePotionType()) {
        var type = potionMeta.getBasePotionType();
        if (type != null) {
          potion =
              Optional.of(
                  RegistryAccess.registryAccess()
                      .getRegistry(RegistryKey.POTION)
                      .getKeyOrThrow(type)
                      .getKey());
        }
      }
    }
    return new ItemFacts(stack.getType().name(), name, Map.copyOf(enchantments), potion);
  }

  /** How many matching items {@code player} carries. */
  static int count(Player player, ItemMatch match) {
    var total = 0;
    for (var stack : Locations.slots(player.getInventory().getStorageContents())) {
      if (stack != null && matches(stack, match)) {
        total += stack.getAmount();
      }
    }
    return total;
  }

  /** Takes up to {@code amount} matching items; returns how many were taken. */
  static int take(Player player, ItemMatch match, int amount) {
    var inventory = player.getInventory();
    var contents = Locations.slots(inventory.getStorageContents());
    var left = amount;
    for (var slot = 0; slot < contents.length && left > 0; slot++) {
      var stack = contents[slot];
      if (stack != null && matches(stack, match)) {
        var taken = Math.min(left, stack.getAmount());
        // An amount of zero empties the slot.
        stack.setAmount(stack.getAmount() - taken);
        left -= taken;
      }
    }
    inventory.setStorageContents(contents);
    return amount - left;
  }

  /** Stacks holding {@code amount} items made to match {@code match}. */
  static List<ItemStack> make(ItemMatch match, int amount) {
    var material = Material.valueOf(match.material());
    var stacks = new ArrayList<ItemStack>();
    var left = amount;
    while (left > 0) {
      var stack = ItemStack.of(material, 1);
      decorate(stack, match);
      var size = Math.min(left, stack.getMaxStackSize());
      stack.setAmount(size);
      stacks.add(stack);
      left -= size;
    }
    return stacks;
  }

  private static void decorate(ItemStack stack, ItemMatch match) {
    var enchantments = RegistryAccess.registryAccess().getRegistry(RegistryKey.ENCHANTMENT);
    match
        .enchantments()
        .forEach(
            (key, level) ->
                stack.addUnsafeEnchantment(
                    enchantments.getOrThrow(NamespacedKey.minecraft(key)), level));
    if (match.name().isEmpty() && match.potion().isEmpty()) {
      return;
    }
    var meta = stack.getItemMeta();
    match.name().ifPresent(text -> meta.customName(Component.text(text)));
    if (meta instanceof PotionMeta potionMeta) {
      match
          .potion()
          .ifPresent(
              key ->
                  potionMeta.setBasePotionType(
                      RegistryAccess.registryAccess()
                          .getRegistry(RegistryKey.POTION)
                          .getOrThrow(NamespacedKey.minecraft(key))));
    }
    stack.setItemMeta(meta);
  }

  private static boolean matches(ItemStack stack, ItemMatch match) {
    if (stack.getType().isAir()) {
      return false;
    }
    if (!stack.getType().name().equals(match.material())) {
      return false;
    }
    return !match.hasComponents() || match.matches(facts(stack));
  }
}
