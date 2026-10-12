package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.snapshot.PlayerStates;
import com.shepherdjerred.thestorm.rwf.domain.bomb.FuseBonus;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.kit.ArmorSlot;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemLook;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitAccess;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitLayout;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import com.shepherdjerred.thestorm.rwf.domain.kit.LoreLines;
import io.papermc.paper.datacomponent.DataComponentTypes;
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
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Color;
import org.bukkit.FireworkEffect;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemFlag;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.FireworkEffectMeta;
import org.bukkit.inventory.meta.LeatherArmorMeta;
import org.bukkit.inventory.meta.PotionMeta;

/**
 * Kit item stacks built once from their specs at enable, so an unknown material or enchantment
 * stops the module instead of failing mid-match. Kit gear is unbreakable and tagged so it never
 * leaves the match; the Bomb Fuse sits in hotbar slot 0 and is tagged separately so it can be
 * locked there.
 */
final class KitFactory {

  /** The hotbar slot the Bomb Fuse is locked into. */
  static final int FUSE_SLOT = 0;

  /** The hotbar slot of the lobby's kit selector. */
  static final int SELECTOR_SLOT = 8;

  /** The hotbar slot of the lobby's leave item. */
  static final int LEAVE_SLOT = 7;

  /** The hotbar's size. */
  static final int HOTBAR = 9;

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

  /** The tags its items carry. */
  Keys keys() {
    return keys;
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
      var single = spec.times(1);
      if (!spec.isGap() && !templates.containsKey(single)) {
        stack(single, problems).ifPresent(stack -> templates.put(single, stack));
      }
    }
    for (var kit : kits) {
      var icon = Material.matchMaterial(kit.menu().icon());
      if (icon == null || !icon.isItem()) {
        problems.add(kit.id() + "'s menu icon " + kit.menu().icon() + " is not an item");
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

  /** Empties {@code player} and gives them {@code kit} laid out as the kit does. */
  void equip(Player player, KitSpec kit) {
    equip(player, kit, Optional.empty(), Optional.empty());
  }

  /**
   * Empties {@code player} and gives them {@code kit}: the fuse in slot 0, the other items where
   * {@code layout} puts them (the kit's own layout when it has none or it no longer fits), and the
   * armor. Items dyed in the team colour take {@code team}'s, once there is one.
   */
  void equip(Player player, KitSpec kit, Optional<TeamColor> team, Optional<KitLayout> layout) {
    PlayerStates.wipe(player, GameMode.SURVIVAL);
    var inventory = player.getInventory();
    var held = FUSE_SLOT;
    for (var placement : KitLayout.place(kit, layout)) {
      if (placement.index() == 0) {
        inventory.setItem(FUSE_SLOT, fuse(kit.fuseBonus()));
        continue;
      }
      inventory.setItem(placement.slot(), kitItem(placement.item(), team));
      if (placement.index() == 1) {
        held = placement.slot();
      }
    }
    for (var piece : kit.armor()) {
      inventory.setItem(equipmentSlot(piece.slot().orElseThrow()), kitItem(piece, team));
    }
    inventory.setHeldItemSlot(held < HOTBAR ? held : FUSE_SLOT);
  }

  /**
   * The lobby's two items: the kit selector (a nether star) in the last hotbar slot and the leave
   * item (red dye) beside it. Given on entering the lobby and after every pick there, since
   * equipping empties the inventory; never once the match is live.
   */
  void giveLobbyItems(Player player) {
    var inventory = player.getInventory();
    inventory.setItem(SELECTOR_SLOT, selector());
    inventory.setItem(LEAVE_SLOT, leaveItem());
  }

  ItemStack selector() {
    var stack =
        named(
            Material.NETHER_STAR,
            Component.text("Choose kit", NamedTextColor.YELLOW),
            "Right-click to choose your kit");
    keys.tagSelector(stack);
    return stack;
  }

  ItemStack leaveItem() {
    var stack =
        named(
            Material.RED_DYE,
            Component.text("Leave match", NamedTextColor.RED),
            "Right-click to go back to survival");
    keys.tagLeave(stack);
    return stack;
  }

  /**
   * {@code kit}'s icon in the kit menu: its icon material, its name, its summary as lore and what a
   * click does; the kit a player has picked glints.
   */
  ItemStack icon(KitSpec kit, boolean picked) {
    var material = Material.matchMaterial(kit.menu().icon());
    if (material == null) {
      throw new IllegalStateException("kit icons are checked at enable: " + kit.menu().icon());
    }
    var stack = ItemStack.of(material);
    kit.menu().tint().ifPresent(tint -> dye(stack, Color.fromRGB(ItemLook.rgb(tint))));
    var lore = new ArrayList<Component>();
    for (var line : kit.menu().summary()) {
      lore.add(plain(line, NamedTextColor.GRAY));
    }
    lore.add(Component.empty());
    lore.add(
        picked
            ? plain("Your kit", NamedTextColor.GREEN)
            : plain("Click to choose", NamedTextColor.YELLOW));
    stack.editMeta(
        meta -> {
          meta.displayName(
              Component.text(kit.name(), NamedTextColor.GOLD)
                  .decoration(TextDecoration.ITALIC, false)
                  .decoration(TextDecoration.BOLD, true));
          meta.lore(lore);
          meta.setEnchantmentGlintOverride(picked);
          meta.addItemFlags(ItemFlag.values());
        });
    return stack;
  }

  /**
   * How a kit stands for one player in the kit menu.
   *
   * @param lock why they may not pick it, if they may not
   * @param freeThisWeek whether it is open only because it rotates free this week
   * @param picked whether it is the kit they picked
   * @param shop whether the shop is on for them, so prices and tiers are shown
   */
  record IconState(
      Optional<KitAccess.Lock> lock, boolean freeThisWeek, boolean picked, boolean shop) {}

  /**
   * {@code kit}'s kit-menu icon for one player, as Red Warfare's {@code KitInventory} drew it: the
   * gold name; LOCKED with the price and "Click to purchase", or LOCKED alone; then the
   * description, each of its lines in yellow, all laid out by {@link LoreLines}. The Storm adds the
   * tier and price line while the shop is on, and FREE THIS WEEK for a kit open only through the
   * rotation, neither of which Red Warfare had.
   */
  ItemStack menuIcon(KitSpec kit, IconState state) {
    var material = Material.matchMaterial(kit.menu().icon());
    if (material == null) {
      throw new IllegalStateException("kit icons are checked at enable: " + kit.menu().icon());
    }
    var stack = ItemStack.of(material);
    kit.menu().tint().ifPresent(tint -> dye(stack, Color.fromRGB(ItemLook.rgb(tint))));
    var lore = List.<String>of();
    if (state.shop()) {
      lore =
          LoreLines.add(
              lore,
              "§7"
                  + kit.tier().displayName()
                  + " kit, "
                  + (kit.purchasable() ? kit.price() + " credits" : "always free"));
    }
    switch (state.lock().orElse(null)) {
      case NOT_OWNED -> {
        lore = LoreLines.add(lore, "§4§lLOCKED §bPurchase for " + kit.price() + " credits");
        lore = LoreLines.add(lore, "§bClick to purchase");
      }
      case UNAVAILABLE -> lore = LoreLines.add(lore, "§4§lLOCKED");
      case null -> {
        if (state.freeThisWeek()) {
          lore = LoreLines.add(lore, "§a§lFREE THIS WEEK");
        }
      }
    }
    for (var line : kit.description().split("\n", -1)) {
      lore = LoreLines.add(lore, "§e" + line);
    }
    var lines = lore.stream().map(KitFactory::legacy).toList();
    stack.editMeta(
        meta -> {
          meta.displayName(legacy("§6" + kit.name()));
          meta.lore(lines);
          meta.addItemFlags(BUILDER_FLAGS);
        });
    return stack;
  }

  private static ItemStack named(Material material, Component name, String hint) {
    var stack = ItemStack.of(material);
    stack.editMeta(
        meta -> {
          meta.displayName(name.decoration(TextDecoration.ITALIC, false));
          meta.lore(List.of(plain(hint, NamedTextColor.GRAY)));
        });
    return stack;
  }

  /** A chat colour by the lower-case name {@link ItemLook} uses. */
  private static NamedTextColor color(String name) {
    var color = NamedTextColor.NAMES.value(name);
    if (color == null) {
      throw new IllegalStateException("item colours are checked by ItemLook: " + name);
    }
    return color;
  }

  private static Component plain(String text, NamedTextColor color) {
    return Component.text(text, color).decoration(TextDecoration.ITALIC, false);
  }

  /** {@code level} in Roman numerals, as enchantment levels are shown; 1 to 10. */
  static String roman(int level) {
    return ROMAN[level - 1];
  }

  /** Replaces the fuse in slot 0 with one carrying {@code bonus}. */
  void giveFuse(Player player, FuseBonus bonus) {
    player.getInventory().setItem(FUSE_SLOT, fuse(Optional.of(bonus)));
  }

  /**
   * The Bomb Fuse. A bonus is written under its label after a gap, in gray, and makes it glint, as
   * Red Warfare's {@code FuseType.setLevel} did.
   */
  ItemStack fuse(Optional<FuseBonus> bonus) {
    var stack = template(KitSpec.FUSE).clone();
    bonus.ifPresent(
        b -> {
          var current = stack.lore();
          var lore = new ArrayList<Component>(current == null ? List.of() : current);
          lore.add(Component.empty());
          lore.add(
              Component.text(b.type().loreName() + " " + roman(b.level()))
                  .color(NamedTextColor.GRAY)
                  .decoration(TextDecoration.ITALIC, false));
          stack.lore(lore);
          stack.editMeta(meta -> meta.setEnchantmentGlintOverride(true));
        });
    keys.tagFuse(stack);
    return stack;
  }

  /** The hotbar slot of the team chestplate. */
  static final int TEAM_SLOT = 8;

  /**
   * Red Warfare's TEAM_HOTBAR item: a leather chestplate in the team's colour, named for the team,
   * in the last hotbar slot. Tagged as a kit item, so it never leaves the match.
   */
  ItemStack teamHotbar(TeamColor team) {
    var stack = new ItemStack(Material.LEATHER_CHESTPLATE);
    var color = Scoreboards.color(team);
    stack.editMeta(
        LeatherArmorMeta.class,
        meta -> {
          meta.setColor(Hats.dye(team));
          meta.displayName(
              Component.text(team.displayName(), color, TextDecoration.BOLD)
                  .decoration(TextDecoration.ITALIC, false));
          meta.lore(
              List.of(
                  Component.text("You are on " + team.displayName(), color)
                      .decoration(TextDecoration.ITALIC, false)));
        });
    keys.tag(stack);
    return stack;
  }

  /** A kit item: tagged so it never leaves the match. */
  ItemStack kitItem(ItemSpec spec) {
    return kitItem(spec, Optional.empty());
  }

  /**
   * A kit item for a member of {@code team}: an item dyed in the team colour takes it (a banner
   * becomes the team's banner); with no team yet it stays as built.
   */
  ItemStack kitItem(ItemSpec spec, Optional<TeamColor> team) {
    var stack = template(spec).clone();
    if (spec.look().dye().filter(ItemLook.TEAM_DYE::equals).isPresent() && team.isPresent()) {
      var color = team.orElseThrow();
      var banner = banner(stack.getType(), color);
      if (banner.isPresent()) {
        stack = stack.withType(banner.orElseThrow());
      } else {
        dye(stack, Classic.dye(color));
      }
    }
    keys.tag(stack);
    return stack;
  }

  /** The banner in {@code team}'s colour, when {@code material} is a banner. */
  private static Optional<Material> banner(Material material, TeamColor team) {
    if (!material.name().endsWith("_BANNER")) {
      return Optional.empty();
    }
    return Optional.of(
        switch (team) {
          case RED -> Material.RED_BANNER;
          case BLUE -> Material.BLUE_BANNER;
          case GREEN -> Material.GREEN_BANNER;
          case PURPLE -> Material.PURPLE_BANNER;
          case YELLOW -> Material.YELLOW_BANNER;
        });
  }

  /** Colours leather, a firework star or a potion; anything else is left as it is. */
  private static void dye(ItemStack stack, Color color) {
    stack.editMeta(
        meta -> {
          switch (meta) {
            case LeatherArmorMeta leather -> leather.setColor(color);
            case FireworkEffectMeta star ->
                star.setEffect(FireworkEffect.builder().withColor(color).build());
            case PotionMeta potion -> potion.setColor(color);
            default -> {}
          }
        });
  }

  /** {@code spec}'s stack, built at enable as one item and given {@code spec}'s amount. */
  private ItemStack template(ItemSpec spec) {
    var template = templates.get(spec.times(1));
    if (template == null) {
      throw new IllegalArgumentException("item was not built at enable: " + spec);
    }
    var stack = template.clone();
    stack.setAmount(spec.amount());
    return stack;
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
        stack.isEmpty() ? Optional.empty() : slot,
        ItemLook.PLAIN);
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

  /**
   * Red Warfare's item flags and unbreakability. Its {@code ItemBuilder} hid everything but
   * enchantments on what it built (every item with a name, lore, enchantment, glint or dye); armor
   * was made unbreakable keeping those flags; and {@code Kit.giveItems} made every kit item of more
   * than 16 durability unbreakable with one flag in place of the rest: attributes hidden for a
   * weapon {@code UtilInv.getDamage} rates above 1, otherwise the Unbreakable line hidden.
   */
  private static void flag(ItemStack stack, ItemSpec spec, Material material) {
    var built =
        spec.name().isPresent()
            || !spec.look().lore().isEmpty()
            || !spec.enchantments().isEmpty()
            || spec.look().glint()
            || spec.look().dye().isPresent();
    if (spec.slot().isPresent()) {
      stack.editMeta(
          meta -> {
            meta.setUnbreakable(true);
            if (built) {
              meta.addItemFlags(BUILDER_FLAGS);
            }
          });
      return;
    }
    if (material.getMaxDurability() > 16) {
      stack.editMeta(
          meta -> {
            meta.setUnbreakable(true);
            meta.removeItemFlags(ItemFlag.values());
            meta.addItemFlags(
                weaponDamage(material) > 1 ? ItemFlag.HIDE_ATTRIBUTES : ItemFlag.HIDE_UNBREAKABLE);
          });
      return;
    }
    if (built) {
      stack.editMeta(meta -> meta.addItemFlags(BUILDER_FLAGS));
    }
  }

  /**
   * What {@code ItemBuilder.setHideInfo} hid: every flag Minecraft 1.12 had but enchantments and
   * {@code HIDE_POTION_EFFECTS}, whose successor Paper has deprecated (see KITS.md); flags added
   * since (dye, armor trim, stored enchantments) did not exist and stay shown.
   */
  static final ItemFlag[] BUILDER_FLAGS = {
    ItemFlag.HIDE_ATTRIBUTES,
    ItemFlag.HIDE_UNBREAKABLE,
    ItemFlag.HIDE_DESTROYS,
    ItemFlag.HIDE_PLACED_ON
  };

  /** Red Warfare's {@code UtilInv.getDamage}, by modern material names. */
  static double weaponDamage(Material material) {
    var name = material.name();
    double damage = 1;
    if (name.contains("DIAMOND_")) {
      damage = 3;
    } else if (name.contains("IRON_")) {
      damage = 2;
    } else if (name.contains("STONE_")) {
      damage = 1;
    } else if (name.contains("GOLDEN_")) {
      damage = 0.5;
    } else if (name.contains("WOODEN_")) {
      damage = 0;
    }
    if (name.contains("_SWORD")) {
      return damage + 4;
    } else if (name.contains("_AXE")) {
      return damage + 3;
    } else if (name.contains("_PICKAXE")) {
      return damage + 2;
    } else if (name.contains("_SHOVEL")) {
      return damage + 1;
    }
    return 1;
  }

  /** Legacy section-sign text as a component, never italic, as 1.12 showed coloured lore. */
  static Component legacy(String text) {
    return LegacyComponentSerializer.legacySection()
        .deserialize(text)
        .decorationIfAbsent(TextDecoration.ITALIC, TextDecoration.State.FALSE);
  }

  /** The section-sign code of a chat colour by the lower-case name {@link ItemLook} uses. */
  static String legacyCode(String name) {
    return LegacyComponentSerializer.legacySection()
        .serialize(Component.text("x", color(name)))
        .replace("x", "");
  }

  private static Optional<ItemStack> stack(ItemSpec spec, List<String> problems) {
    var material = Material.matchMaterial(spec.material());
    if (material == null || !material.isItem()) {
      problems.add(spec.material() + " is not an item");
      return Optional.empty();
    }
    var stack = ItemStack.of(material, spec.amount());
    var look = spec.look();
    // Red Warfare's ItemBuilder.setTitle coloured an uncoloured title gray.
    spec.name()
        .ifPresent(
            name ->
                stack.editMeta(
                    meta ->
                        meta.displayName(
                            Component.text(
                                    name,
                                    look.nameColor()
                                        .map(KitFactory::color)
                                        .orElse(NamedTextColor.GRAY))
                                .decoration(TextDecoration.ITALIC, false))));
    if (!look.lore().isEmpty()) {
      var code = legacyCode(look.loreColor().orElseThrow());
      var lines = new ArrayList<String>();
      for (var line : look.lore()) {
        lines.add(line.isEmpty() ? line : code + line);
      }
      stack.lore(LoreLines.of(lines).stream().map(KitFactory::legacy).toList());
    }
    if (look.glint()) {
      stack.editMeta(meta -> meta.setEnchantmentGlintOverride(true));
    }
    look.dye()
        .filter(dye -> !ItemLook.TEAM_DYE.equals(dye))
        .ifPresent(dye -> dye(stack, Color.fromRGB(ItemLook.rgb(dye))));
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
    flag(stack, spec, material);
    if (spec.amount() > material.getMaxStackSize()) {
      overstack(stack, spec.amount());
    }
    return Optional.of(stack);
  }

  /**
   * Red Warfare handed out some unstackable items several to a slot, such as the Sacrificial's two
   * shears; a stack that holds {@code amount} does the same now. Such an item cannot also wear
   * down, which it never did, being unbreakable.
   */
  private static void overstack(ItemStack stack, int amount) {
    stack.setAmount(1);
    stack.unsetData(DataComponentTypes.DAMAGE);
    stack.unsetData(DataComponentTypes.MAX_DAMAGE);
    stack.setData(DataComponentTypes.MAX_STACK_SIZE, amount);
    stack.setAmount(amount);
  }
}
