package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.snapshot.PlayerStates;
import com.shepherdjerred.thestorm.rwf.domain.bomb.FuseBonus;
import com.shepherdjerred.thestorm.rwf.domain.kit.ArmorSlot;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import net.kyori.adventure.key.Key;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;

/**
 * Kit item stacks built once from their specs at enable, so an unknown material or enchantment
 * stops the module instead of failing mid-match. Kit gear is unbreakable and tagged so it never
 * leaves the match; the Bomb Fuse sits in hotbar slot 0 and is tagged separately so it can be
 * locked there.
 */
final class KitFactory {

  /** The hotbar slot the Bomb Fuse is locked into. */
  static final int FUSE_SLOT = 0;

  private static final String[] ROMAN = {
    "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"
  };

  private final Keys keys;
  private final Map<ItemSpec, ItemStack> templates;
  private final Map<String, KitSpec> kits;

  private KitFactory(Keys keys, Map<ItemSpec, ItemStack> templates, Map<String, KitSpec> kits) {
    this.keys = keys;
    this.templates = Map.copyOf(templates);
    this.kits = Map.copyOf(kits);
  }

  /** Builds every item of every kit, or throws naming everything the server does not know. */
  static KitFactory build(Keys keys, Collection<KitSpec> kits) {
    var problems = new ArrayList<String>();
    var templates = new HashMap<ItemSpec, ItemStack>();
    var byId = new TreeMap<String, KitSpec>();
    var specs = new ArrayList<ItemSpec>();
    specs.add(KitSpec.FUSE);
    for (var kit : kits) {
      byId.put(kit.id(), kit);
      specs.addAll(kit.items());
      specs.addAll(kit.armor());
    }
    for (var spec : specs) {
      if (!templates.containsKey(spec)) {
        stack(spec, problems).ifPresent(stack -> templates.put(spec, stack));
      }
    }
    if (!problems.isEmpty()) {
      throw new IllegalStateException("Invalid items in rwf kits: " + String.join("; ", problems));
    }
    return new KitFactory(keys, templates, byId);
  }

  KitSpec require(String kitId) {
    var kit = kits.get(kitId);
    if (kit == null) {
      throw new IllegalArgumentException("unknown kit " + kitId);
    }
    return kit;
  }

  Collection<String> kitIds() {
    return kits.keySet();
  }

  /** Empties {@code player} and gives them {@code kit}: fuse in slot 0, hotbar, armor. */
  void equip(Player player, KitSpec kit) {
    PlayerStates.wipe(player, GameMode.SURVIVAL);
    var inventory = player.getInventory();
    inventory.setItem(FUSE_SLOT, fuse(kit.fuseBonus()));
    var slot = FUSE_SLOT + 1;
    for (var spec : kit.hotbar()) {
      inventory.setItem(slot++, kitItem(spec));
    }
    for (var piece : kit.armor()) {
      inventory.setItem(equipmentSlot(piece.slot().orElseThrow()), kitItem(piece));
    }
    inventory.setHeldItemSlot(FUSE_SLOT + 1);
  }

  /** {@code level} in Roman numerals, as enchantment levels are shown; 1 to 10. */
  static String roman(int level) {
    return ROMAN[level - 1];
  }

  /** Replaces the fuse in slot 0 with one carrying {@code bonus}. */
  void giveFuse(Player player, FuseBonus bonus) {
    player.getInventory().setItem(FUSE_SLOT, fuse(Optional.of(bonus)));
  }

  /** The Bomb Fuse, with {@code bonus} on its lore when there is one. */
  ItemStack fuse(Optional<FuseBonus> bonus) {
    var stack = template(KitSpec.FUSE).clone();
    bonus.ifPresent(
        b ->
            stack.lore(
                List.of(
                    Component.text(b.type().loreName() + " " + roman(b.level()))
                        .color(NamedTextColor.GRAY)
                        .decoration(TextDecoration.ITALIC, false))));
    keys.tagFuse(stack);
    return stack;
  }

  /** A kit item: tagged so it never leaves the match. */
  ItemStack kitItem(ItemSpec spec) {
    var stack = template(spec).clone();
    keys.tag(stack);
    return stack;
  }

  private ItemStack template(ItemSpec spec) {
    var template = templates.get(spec);
    if (template == null) {
      throw new IllegalArgumentException("item was not built at enable: " + spec);
    }
    return template;
  }

  static EquipmentSlot equipmentSlot(ArmorSlot slot) {
    return switch (slot) {
      case HELMET -> EquipmentSlot.HEAD;
      case CHESTPLATE -> EquipmentSlot.CHEST;
      case LEGGINGS -> EquipmentSlot.LEGS;
      case BOOTS -> EquipmentSlot.FEET;
    };
  }

  /** The spec of a stack as it is worn or held now, for the damage formula. */
  static ItemSpec spec(ItemStack stack, Optional<ArmorSlot> slot) {
    var material = stack.isEmpty() ? Material.AIR : stack.getType();
    var enchantments = new TreeMap<String, Integer>();
    if (!stack.isEmpty()) {
      stack
          .getEnchantments()
          .forEach((enchantment, level) -> enchantments.put(enchantment.getKey().getKey(), level));
    }
    return new ItemSpec(
        material.name(),
        1,
        Optional.empty(),
        enchantments,
        stack.isEmpty() ? Optional.empty() : slot);
  }

  /** What {@code player} wears, as specs. */
  static List<ItemSpec> armor(Player player) {
    var inventory = player.getInventory();
    var armor = new ArrayList<ItemSpec>();
    for (var slot : ArmorSlot.values()) {
      var piece = inventory.getItem(equipmentSlot(slot));
      if (!piece.isEmpty()) {
        armor.add(spec(piece, Optional.of(slot)));
      }
    }
    return armor;
  }

  /** The level of {@code key} on {@code stack}, 0 when absent. */
  static int enchantmentLevel(ItemStack stack, String key) {
    if (stack.isEmpty()) {
      return 0;
    }
    var enchantment = enchantments().get(Key.key(key));
    return enchantment == null ? 0 : stack.getEnchantmentLevel(enchantment);
  }

  private static org.bukkit.Registry<Enchantment> enchantments() {
    return RegistryAccess.registryAccess().getRegistry(RegistryKey.ENCHANTMENT);
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
                            Component.text(name).decoration(TextDecoration.ITALIC, false))));
    var registry = enchantments();
    spec.enchantments()
        .forEach(
            (key, level) -> {
              var enchantment = registry.get(Key.key(key));
              if (enchantment == null) {
                problems.add("unknown enchantment " + key + " on " + spec.material());
              } else {
                stack.addUnsafeEnchantment(enchantment, level);
              }
            });
    if (material.getMaxDurability() > 0) {
      stack.editMeta(meta -> meta.setUnbreakable(true));
    }
    return Optional.of(stack);
  }
}
