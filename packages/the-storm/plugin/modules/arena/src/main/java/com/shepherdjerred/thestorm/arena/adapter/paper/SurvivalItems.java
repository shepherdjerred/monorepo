package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalClass;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

/** Physical, run-bound resources. Spending and crafting are atomic on the server thread. */
final class SurvivalItems {
  record Payment(
      UUID run,
      long id,
      UUID player,
      com.shepherdjerred.thestorm.arena.domain.survival.SupplyBank.Payment sources) {}

  private final Keys keys;
  private final UUID run;
  private final SurvivalFeedback feedback;
  private final SurvivalContent content;
  private final SurvivalBank bank = new SurvivalBank();
  private final Map<Long, Payment> reserved = new java.util.HashMap<>();
  private long serial;

  SurvivalItems(Keys keys, UUID run, SurvivalFeedback feedback, SurvivalContent content) {
    this.keys = keys;
    this.run = run;
    this.feedback = feedback;
    this.content = content;
  }

  static Material material(String id) {
    var result = Material.matchMaterial(id);
    if (result == null || !result.isItem()) {
      throw new IllegalArgumentException("Unknown item: " + id);
    }
    return result;
  }

  static void validate(SurvivalContent content) {
    content
        .recipes()
        .forEach(
            recipe -> {
              material(recipe.material());
              recipe.ingredients().keySet().forEach(SurvivalItems::material);
              var output = ItemStack.of(material(recipe.material()), recipe.amount());
              validateRecipe(recipe, output);
            });
    content.zones().stream()
        .flatMap(z -> z.resources().stream())
        .forEach(resource -> material(resource.material()));
    content.legendaries().forEach(reward -> material(reward.material()));
  }

  private static org.bukkit.enchantments.Enchantment enchantment(
      SurvivalContent.EquipmentEnchantment id) {
    var result =
        io.papermc.paper.registry.RegistryAccess.registryAccess()
            .getRegistry(io.papermc.paper.registry.RegistryKey.ENCHANTMENT)
            .get(org.bukkit.NamespacedKey.minecraft(id.name().toLowerCase(java.util.Locale.ROOT)));
    if (result == null) throw new IllegalArgumentException("Unknown enchantment " + id);
    return result;
  }

  private static void validateRecipe(SurvivalContent.Recipe recipe, ItemStack output) {
    if ((recipe.potion() != SurvivalContent.PotionKind.NONE)
        != (output.getType() == Material.POTION))
      throw new IllegalArgumentException("Potion type must match item for " + recipe.id());
    recipe
        .enchantments()
        .forEach(
            (id, level) -> {
              var enchantment = enchantment(id);
              if (!enchantment.canEnchantItem(output) || level > enchantment.getMaxLevel())
                throw new IllegalArgumentException("Incompatible enchantment in " + recipe.id());
            });
  }

  ItemStack recipe(SurvivalContent.Recipe recipe) {
    var result = stack(material(recipe.material()), recipe.amount());
    if (recipe.potion() != SurvivalContent.PotionKind.NONE)
      result.editMeta(
          meta -> {
            var potion = (org.bukkit.inventory.meta.PotionMeta) meta;
            potion.setBasePotionType(org.bukkit.potion.PotionType.valueOf(recipe.potion().name()));
          });
    recipe.enchantments().forEach((id, level) -> result.addEnchantment(enchantment(id), level));
    return result;
  }

  static java.util.Optional<org.bukkit.inventory.EquipmentSlot> armorSlot(Material material) {
    var name = material.name();
    if (name.endsWith("_HELMET"))
      return java.util.Optional.of(org.bukkit.inventory.EquipmentSlot.HEAD);
    if (name.endsWith("_CHESTPLATE"))
      return java.util.Optional.of(org.bukkit.inventory.EquipmentSlot.CHEST);
    if (name.endsWith("_LEGGINGS"))
      return java.util.Optional.of(org.bukkit.inventory.EquipmentSlot.LEGS);
    if (name.endsWith("_BOOTS"))
      return java.util.Optional.of(org.bukkit.inventory.EquipmentSlot.FEET);
    return java.util.Optional.empty();
  }

  boolean craft(Player player, SurvivalContent.Recipe recipe) {
    var output = recipe(recipe);
    var slot = armorSlot(output.getType());
    if (slot.isPresent()) {
      var previous = player.getInventory().getItem(slot.orElseThrow());
      if (!previous.isEmpty() && !bank.fits(player.getUniqueId(), java.util.List.of(previous))) {
        Texts.error(player, "Make room in your locker for the old armor.");
        return false;
      }
    }
    var payment = reserve(player, recipe.ingredients());
    if (payment.isEmpty()) return false;
    if (slot.isPresent()) {
      var previous = player.getInventory().getItem(slot.orElseThrow());
      if (!previous.isEmpty() && !bank.store(player.getUniqueId(), java.util.List.of(previous)))
        throw new IllegalStateException("Armor locker capacity changed during crafting");
      player.getInventory().setItem(slot.orElseThrow(), output);
    } else if (!deliver(player, java.util.List.of(output))) {
      refund(player, payment.orElseThrow());
      Texts.error(player, "Make room in your inventory or private locker.");
      return false;
    }
    commit(payment.orElseThrow());
    return true;
  }

  ItemStack legendary(com.shepherdjerred.thestorm.arena.domain.survival.LegendaryWeapon id) {
    var reward = content.legendaries().stream().filter(r -> r.id() == id).findFirst().orElseThrow();
    var weapon = stack(material(reward.material()), 1);
    if (id == com.shepherdjerred.thestorm.arena.domain.survival.LegendaryWeapon.TIDEBREAKER)
      weapon.addEnchantment(org.bukkit.enchantments.Enchantment.LOYALTY, 3);
    keys.legendary(weapon, id);
    weapon.editMeta(
        meta -> {
          meta.displayName(
              net.kyori.adventure.text.Component.text(
                  reward.name(),
                  id.special()
                      ? net.kyori.adventure.text.format.NamedTextColor.AQUA
                      : net.kyori.adventure.text.format.NamedTextColor.GOLD));
          meta.lore(
              java.util.List.of(net.kyori.adventure.text.Component.text(reward.description())));
        });
    return weapon;
  }

  java.util.Optional<com.shepherdjerred.thestorm.arena.domain.survival.LegendaryWeapon> legendary(
      ItemStack item) {
    return owns(item) ? keys.legendary(item) : java.util.Optional.empty();
  }

  boolean ability(ItemStack item) {
    return owns(item) && keys.isGear(item, "survival_ability");
  }

  SurvivalBank bank() {
    return bank;
  }

  static String name(Material material) {
    var words = material.name().toLowerCase(java.util.Locale.ROOT).replace('_', ' ');
    return Character.toUpperCase(words.charAt(0)) + words.substring(1);
  }

  boolean supply(ItemStack item) {
    return owns(item)
        && item.isSimilar(stack(item.getType(), 1))
        && (item.getType() == Material.EMERALD
            || item.getType() == Material.ARROW
            || content.zones().stream()
                .flatMap(z -> z.resources().stream())
                .anyMatch(r -> r.material().equals(item.getType().name())));
  }

  boolean storable(ItemStack item) {
    return owns(item) && !ability(item) && item.getType() != Material.WRITTEN_BOOK;
  }

  int deposit(Player player) {
    var total = 0;
    var inventory = player.getInventory();
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      var item = inventory.getItem(slot);
      if (item == null || !supply(item)) continue;
      bank.supplies().deposit(item.getType().name(), item.getAmount());
      total += item.getAmount();
      inventory.setItem(slot, null);
    }
    return total;
  }

  boolean store(Player player, int slot) {
    var item = player.getInventory().getItem(slot);
    if (item == null || !storable(item)) return false;
    if (supply(item)) bank.supplies().deposit(item.getType().name(), item.getAmount());
    else if (!bank.store(player.getUniqueId(), java.util.List.of(item))) return false;
    player.getInventory().setItem(slot, null);
    return true;
  }

  boolean withdraw(Player player, Material resource, int amount) {
    if (!inventoryFits(player, java.util.List.of(stack(resource, amount)))
        || !bank.supplies().withdraw(resource.name(), amount)) return false;
    if (!deliverInventory(player, java.util.List.of(stack(resource, amount))))
      throw new IllegalStateException("Withdrawal lost its inventory capacity");
    return true;
  }

  boolean withdraw(Player player, int slot) {
    var contents = bank.contents(player.getUniqueId());
    if (slot < 0
        || slot >= contents.length
        || contents[slot] == null
        || !inventoryFits(player, java.util.List.of(contents[slot]))) return false;
    var item = java.util.Objects.requireNonNull(bank.take(player.getUniqueId(), slot));
    if (!deliverInventory(player, java.util.List.of(item)))
      throw new IllegalStateException("Locker withdrawal lost its inventory capacity");
    return true;
  }

  void ability(Player player) {
    var compass = stack(Material.COMPASS, 1);
    keys.gear(compass, "survival_ability");
    compass.editMeta(
        meta -> {
          meta.setEnchantmentGlintOverride(true);
          meta.displayName(net.kyori.adventure.text.Component.text("Class ability · Right-click"));
          meta.lore(
              java.util.List.of(
                  net.kyori.adventure.text.Component.text("Sneak + right-click: class upgrades")));
        });
    player.getInventory().setItem(8, compass);
  }

  /** Simulate the entire bundle before committing a single storage replacement. */
  boolean deliver(Player player, java.util.List<ItemStack> bundle) {
    if (deliverInventory(player, bundle)) return true;
    if (bundle.stream().allMatch(this::storable) && bank.store(player.getUniqueId(), bundle)) {
      Texts.info(player, "Sent to your bank locker.");
      return true;
    }
    return false;
  }

  boolean inventoryFits(Player player, java.util.List<ItemStack> bundle) {
    return SurvivalBank.insert(
        SurvivalBank.copy(
            java.util.Objects.requireNonNull(player.getInventory().getStorageContents())),
        bundle);
  }

  boolean deliverInventory(Player player, java.util.List<ItemStack> bundle) {
    var storage =
        SurvivalBank.copy(
            java.util.Objects.requireNonNull(player.getInventory().getStorageContents()));
    if (!SurvivalBank.insert(storage, bundle)) return false;
    player.getInventory().setStorageContents(storage);
    return true;
  }

  ItemStack stack(Material material, int amount) {
    var result = ItemStack.of(material, amount);
    keys.tag(result, run);
    return result;
  }

  boolean owns(ItemStack item) {
    return keys.belongsTo(item, run);
  }

  int count(Player player, Material material) {
    var count = 0;
    for (var item : java.util.Objects.requireNonNull(player.getInventory().getContents())) {
      if (item != null && item.isSimilar(stack(material, 1))) {
        count += item.getAmount();
      }
    }
    return count;
  }

  boolean fits(Player player, Material material, int amount) {
    var bundle = java.util.List.of(stack(material, amount));
    return supply(bundle.getFirst())
        || inventoryFits(player, bundle)
        || bank.fits(player.getUniqueId(), bundle);
  }

  boolean give(Player player, Material material, int amount) {
    var reward = stack(material, amount);
    if (supply(reward) && !inventoryFits(player, java.util.List.of(reward))) {
      bank.supplies().deposit(material.name(), amount);
      Texts.info(player, "+" + amount + " " + name(material) + " to the team bank.");
      return true;
    }
    if (!fits(player, material, amount)) {
      Texts.error(player, "Make room in your inventory first.");
      feedback.play(player, SurvivalFeedback.Cue.FAILURE);
      return false;
    }
    return deliver(player, java.util.List.of(stack(material, amount)));
  }

  boolean spend(Player player, Map<String, Integer> price) {
    var payment = reserve(player, price);
    if (payment.isEmpty()) return false;
    commit(payment.orElseThrow());
    return true;
  }

  java.util.Optional<Payment> reserve(Player player, Map<String, Integer> price) {
    var carried = new java.util.HashMap<String, Integer>();
    price.keySet().forEach(id -> carried.put(id, count(player, material(id))));
    var sources = bank.supplies().pay(price, carried);
    if (sources.isEmpty()) {
      Texts.error(
          player,
          "Need "
              + price.entrySet().stream()
                  .map(e -> e.getValue() + " " + name(material(e.getKey())))
                  .collect(java.util.stream.Collectors.joining(", "))
              + ".");
      feedback.play(player, SurvivalFeedback.Cue.FAILURE);
      return java.util.Optional.empty();
    }
    sources.orElseThrow().carried().forEach((id, amount) -> remove(player, material(id), amount));
    var payment = new Payment(run, ++serial, player.getUniqueId(), sources.orElseThrow());
    reserved.put(payment.id(), payment);
    return java.util.Optional.of(payment);
  }

  void commit(Payment payment) {
    if (!payment.run().equals(run) || !payment.equals(reserved.get(payment.id())))
      throw new IllegalStateException("Payment was already settled");
    reserved.remove(payment.id());
  }

  void refund(@org.jspecify.annotations.Nullable Player player, Payment payment) {
    commit(payment);
    payment.sources().banked().forEach(bank.supplies()::deposit);
    payment
        .sources()
        .carried()
        .forEach(
            (resource, amount) -> {
              if (player == null
                  || !player.getUniqueId().equals(payment.player())
                  || !deliverInventory(
                      player, java.util.List.of(stack(material(resource), amount))))
                bank.supplies().deposit(resource, amount);
            });
  }

  private void remove(Player player, Material material, int amount) {
    var inventory = player.getInventory();
    var left = amount;
    for (var slot = 0; slot < inventory.getSize() && left > 0; slot++) {
      var item = inventory.getItem(slot);
      if (item != null && item.isSimilar(stack(material, 1))) {
        var taken = Math.min(left, item.getAmount());
        item.setAmount(item.getAmount() - taken);
        left -= taken;
        inventory.setItem(slot, item.isEmpty() ? null : item);
      }
    }
  }

  void equip(Player player, SurvivalClass role, boolean returning) {
    PlayerStates.wipe(player, org.bukkit.GameMode.SURVIVAL);
    give(player, Material.WOODEN_SWORD, 1);
    give(player, Material.BREAD, returning ? 2 : 5);
    player.getInventory().setChestplate(stack(Material.LEATHER_CHESTPLATE, 1));
    if (!returning) {
      player.getInventory().setHelmet(stack(Material.LEATHER_HELMET, 1));
      player.getInventory().setLeggings(stack(Material.LEATHER_LEGGINGS, 1));
      player.getInventory().setBoots(stack(Material.LEATHER_BOOTS, 1));
    }
    switch (role) {
      case FIGHTER -> player.getInventory().setItemInOffHand(stack(Material.SHIELD, 1));
      case RANGER -> {
        give(player, Material.BOW, 1);
        give(player, Material.ARROW, returning ? 12 : 24);
      }
      case MEDIC -> give(player, Material.GOLDEN_APPLE, returning ? 1 : 2);
      case ENGINEER -> {
        give(player, Material.OAK_PLANKS, 12);
        give(player, Material.IRON_INGOT, 4);
      }
      case ALCHEMIST -> {
        give(player, Material.REDSTONE, 8);
        give(player, Material.GLOWSTONE_DUST, 8);
      }
      case BEASTMASTER -> give(player, Material.BONE, 8);
    }
    ability(player);
  }

  boolean weapon(ItemStack stack) {
    return owns(stack)
        && (stack.getType().name().endsWith("_SWORD")
            || stack.getType().name().endsWith("_AXE")
            || stack.getType().name().endsWith("_SPEAR")
            || stack.getType() == Material.MACE
            || stack.getType() == Material.BOW
            || stack.getType() == Material.CROSSBOW
            || stack.getType() == Material.TRIDENT
            || legendary(stack).isPresent());
  }

  int tier(ItemStack stack) {
    return keys.upgrade(stack);
  }

  double multiplier(ItemStack stack) {
    if (!weapon(stack)) return 1;
    return switch (tier(stack)) {
      case 0 -> 1;
      case 1 -> 1.15;
      case 2 -> 1.35;
      case 3 -> 1.55;
      default -> throw new IllegalStateException("Invalid weapon tier");
    };
  }

  void upgrade(ItemStack stack, int tier) {
    if (!weapon(stack) || tier < 1 || tier > 3)
      throw new IllegalArgumentException("Invalid upgrade");
    keys.upgrade(stack, tier);
    stack.editMeta(
        meta -> {
          meta.displayName(
              net.kyori.adventure.text.Component.text(
                  "Pack-a-Punch "
                      + tier
                      + " · "
                      + legendary(stack)
                          .map(
                              id ->
                                  content.legendaries().stream()
                                      .filter(r -> r.id() == id)
                                      .findFirst()
                                      .orElseThrow()
                                      .name())
                          .orElseGet(() -> name(stack.getType()))));
          if (meta instanceof org.bukkit.inventory.meta.Damageable damageable)
            damageable.setDamage(0);
        });
    var enchantment = SurvivalEquipment.primary(stack);
    if (enchantment.canEnchantItem(stack)
        && !stack.getItemMeta().hasConflictingEnchant(enchantment))
      stack.addEnchantment(enchantment, Math.max(stack.getEnchantmentLevel(enchantment), tier));
    if (org.bukkit.enchantments.Enchantment.UNBREAKING.canEnchantItem(stack))
      stack.addEnchantment(
          org.bukkit.enchantments.Enchantment.UNBREAKING,
          Math.max(
              stack.getEnchantmentLevel(org.bukkit.enchantments.Enchantment.UNBREAKING), tier));
  }

  void debug(Player player, int round) {
    var preset = com.shepherdjerred.thestorm.arena.domain.survival.DebugPreset.at(round);
    if (preset.iron()) {
      var inventory = player.getInventory();
      inventory.setItem(0, stack(Material.IRON_SWORD, 1));
      inventory.setHelmet(stack(Material.IRON_HELMET, 1));
      inventory.setChestplate(stack(Material.IRON_CHESTPLATE, 1));
      inventory.setLeggings(stack(Material.IRON_LEGGINGS, 1));
      inventory.setBoots(stack(Material.IRON_BOOTS, 1));
      give(player, Material.IRON_INGOT, 16);
      give(player, Material.REDSTONE, 16);
      give(player, Material.BREAD, 12);
      give(player, Material.EMERALD, preset.emeralds());
    }
    if (preset.weaponTier() > 0) {
      for (var item :
          java.util.Objects.requireNonNull(player.getInventory().getStorageContents())) {
        if (item != null && weapon(item)) upgrade(item, preset.weaponTier());
      }
    }
  }

  static void heal(Player player, double amount) {
    var max = player.getAttribute(org.bukkit.attribute.Attribute.MAX_HEALTH);
    if (max == null) {
      throw new IllegalStateException("Player has no max health");
    }
    player.setHealth(Math.min(max.getValue(), player.getHealth() + amount));
    player.addPotionEffect(new PotionEffect(PotionEffectType.REGENERATION, 60, 0));
  }
}
