package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.kit.ItemSpec;
import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.kyori.adventure.key.Key;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.PotionMeta;
import org.bukkit.potion.PotionEffectType;

/**
 * Item stacks built once from their specs at enable, so an unknown material, enchantment or potion
 * stops the module instead of failing mid-game. Arena gear is unbreakable: nobody repairs a kit
 * between waves.
 */
final class ItemFactory {

  private final Keys keys;
  private final Map<ItemSpec, ItemStack> templates;

  private ItemFactory(Keys keys, Map<ItemSpec, ItemStack> templates) {
    this.keys = keys;
    this.templates = Map.copyOf(templates);
  }

  /** Builds every spec, or throws naming everything the server does not know. */
  static ItemFactory build(Keys keys, Collection<ItemSpec> specs) {
    var problems = new ArrayList<String>();
    var templates = new HashMap<ItemSpec, ItemStack>();
    for (var spec : specs) {
      if (!templates.containsKey(spec)) {
        stack(spec, problems).ifPresent(stack -> templates.put(spec, stack));
      }
    }
    if (!problems.isEmpty()) {
      throw new IllegalStateException(
          "Invalid items in arena content: " + String.join("; ", problems));
    }
    return new ItemFactory(keys, templates);
  }

  /** An arena item: tagged so it can never leave the arena. */
  ItemStack arenaItem(ItemSpec spec) {
    var stack = template(spec).clone();
    keys.tag(stack);
    return stack;
  }

  /** A reward item the player keeps. */
  ItemStack reward(ItemSpec spec) {
    return template(spec).clone();
  }

  private ItemStack template(ItemSpec spec) {
    var template = templates.get(spec);
    if (template == null) {
      throw new IllegalArgumentException("item was not built at enable: " + spec);
    }
    return template;
  }

  /** The effect type for {@code key}, or empty if the server has none. */
  static Optional<PotionEffectType> effect(String key) {
    return Optional.ofNullable(
        RegistryAccess.registryAccess().getRegistry(RegistryKey.MOB_EFFECT).get(Key.key(key)));
  }

  /** Every effect key in {@code effects} the server does not know. */
  static List<String> unknownEffects(Collection<String> effects) {
    return effects.stream().filter(key -> effect(key).isEmpty()).toList();
  }

  private static Optional<ItemStack> stack(ItemSpec spec, List<String> problems) {
    var material = Material.matchMaterial(spec.material());
    if (material == null || !material.isItem()) {
      problems.add(spec.material() + " is not an item");
      return Optional.empty();
    }
    var stack = ItemStack.of(material, spec.amount());
    spec.name()
        .ifPresent(
            name ->
                stack.editMeta(
                    meta ->
                        meta.displayName(
                            Component.text(name)
                                .decoration(TextDecoration.ITALIC, TextDecoration.State.FALSE))));
    var enchantments = RegistryAccess.registryAccess().getRegistry(RegistryKey.ENCHANTMENT);
    spec.enchantments()
        .forEach(
            (key, level) -> {
              var enchantment = enchantments.get(Key.key(key));
              if (enchantment == null) {
                problems.add("unknown enchantment " + key + " on " + spec.material());
              } else {
                stack.addUnsafeEnchantment(enchantment, level);
              }
            });
    spec.potion().ifPresent(potion -> setPotion(stack, potion, problems));
    if (material.getMaxDurability() > 0) {
      stack.editMeta(meta -> meta.setUnbreakable(true));
    }
    return Optional.of(stack);
  }

  private static void setPotion(ItemStack stack, String key, List<String> problems) {
    var type = RegistryAccess.registryAccess().getRegistry(RegistryKey.POTION).get(Key.key(key));
    if (type == null) {
      problems.add("unknown potion " + key);
      return;
    }
    var edited = stack.editMeta(PotionMeta.class, meta -> meta.setBasePotionType(type));
    if (!edited) {
      problems.add(stack.getType() + " cannot hold a potion");
    }
  }
}
