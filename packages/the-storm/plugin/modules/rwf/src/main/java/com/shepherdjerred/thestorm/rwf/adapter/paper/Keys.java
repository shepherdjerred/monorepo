package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.killstreak.Killstreak;
import java.util.Optional;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Entity;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/**
 * The persistent-data tags that mark what belongs to a match: every kit item, the Bomb Fuse and the
 * lobby's kit selector and leave item in particular, the primed TNT and holograms that stand for
 * bombs, and the lobby's display entities. Tagged items never leave the match; tagged entities are
 * removed when a match resets, when the lobby is dressed again, or when they turn up after a crash.
 */
final class Keys {

  /** The attack-speed modifier every combatant carries while inside. */
  static final NamespacedKey ATTACK_SPEED = new NamespacedKey("thestorm", "rwf_attack_speed");

  /** The max-health modifier a kit ability (Juggernaut, Vampire, Bleeder) sets. */
  static final NamespacedKey KIT_HEALTH = new NamespacedKey("thestorm", "rwf_kit_health");

  private final NamespacedKey item;
  private final NamespacedKey fuse;
  private final NamespacedKey bomb;
  private final NamespacedKey lobby;
  private final NamespacedKey selector;
  private final NamespacedKey leave;
  private final NamespacedKey kitEntity;
  private final NamespacedKey compass;
  private final NamespacedKey layoutIndex;
  private final NamespacedKey streak;
  private final NamespacedKey nextGame;
  private final NamespacedKey kitLayout;
  private final NamespacedKey settings;
  private final NamespacedKey mapMenu;

  Keys(Plugin plugin) {
    this.item = new NamespacedKey(plugin, "rwf_item");
    this.fuse = new NamespacedKey(plugin, "rwf_fuse");
    this.bomb = new NamespacedKey(plugin, "rwf_bomb");
    this.lobby = new NamespacedKey(plugin, "rwf_lobby");
    this.selector = new NamespacedKey(plugin, "rwf_selector");
    this.leave = new NamespacedKey(plugin, "rwf_leave");
    this.kitEntity = new NamespacedKey(plugin, "rwf_kit_entity");
    this.compass = new NamespacedKey(plugin, "rwf_compass");
    this.layoutIndex = new NamespacedKey(plugin, "rwf_layout_index");
    this.streak = new NamespacedKey(plugin, "rwf_streak");
    this.nextGame = new NamespacedKey(plugin, "rwf_next_game");
    this.kitLayout = new NamespacedKey(plugin, "rwf_kit_layout");
    this.settings = new NamespacedKey(plugin, "rwf_settings");
    this.mapMenu = new NamespacedKey(plugin, "rwf_map_menu");
  }

  /** Marks {@code entity} as something a kit put in the world: a thrown grenade, an RPG. */
  void tagKitEntity(Entity entity) {
    entity.getPersistentDataContainer().set(kitEntity, PersistentDataType.BOOLEAN, true);
  }

  boolean isKitEntity(Entity entity) {
    return entity.getPersistentDataContainer().has(kitEntity, PersistentDataType.BOOLEAN);
  }

  /** Marks {@code stack} as a kit item. */
  void tag(ItemStack stack) {
    stack.editMeta(
        meta -> meta.getPersistentDataContainer().set(item, PersistentDataType.BOOLEAN, true));
  }

  /** Marks {@code stack} as the Bomb Fuse (a kit item too). */
  void tagFuse(ItemStack stack) {
    tag(stack);
    stack.editMeta(
        meta -> meta.getPersistentDataContainer().set(fuse, PersistentDataType.BOOLEAN, true));
  }

  /** Marks {@code stack} as the lobby's kit selector (a kit item too, so it never leaves). */
  void tagSelector(ItemStack stack) {
    tag(stack);
    stack.editMeta(
        meta -> meta.getPersistentDataContainer().set(selector, PersistentDataType.BOOLEAN, true));
  }

  /** Marks {@code stack} as the lobby's leave item (a kit item too, so it never leaves). */
  void tagLeave(ItemStack stack) {
    tag(stack);
    stack.editMeta(
        meta -> meta.getPersistentDataContainer().set(leave, PersistentDataType.BOOLEAN, true));
  }

  /** Marks {@code stack} as the spectator compass (a kit item too, so it never leaves). */
  void tagCompass(ItemStack stack) {
    tag(stack);
    stack.editMeta(
        meta -> meta.getPersistentDataContainer().set(compass, PersistentDataType.BOOLEAN, true));
  }

  /** Marks a layout editor's {@code stack} as the kit's item at position {@code index}. */
  void tagLayoutIndex(ItemStack stack, int index) {
    stack.editMeta(
        meta ->
            meta.getPersistentDataContainer().set(layoutIndex, PersistentDataType.INTEGER, index));
  }

  /** The kit item position a layout editor's {@code stack} stands for, if it is one. */
  Optional<Integer> layoutIndex(ItemStack stack) {
    if (stack.isEmpty() || !stack.hasItemMeta()) {
      return Optional.empty();
    }
    return Optional.ofNullable(
        stack
            .getItemMeta()
            .getPersistentDataContainer()
            .get(layoutIndex, PersistentDataType.INTEGER));
  }

  /**
   * Marks {@code stack} as {@code reward}'s killstreak item (a kit item too, so it never leaves).
   */
  void tagStreak(ItemStack stack, Killstreak reward) {
    tag(stack);
    stack.editMeta(
        meta ->
            meta.getPersistentDataContainer()
                .set(streak, PersistentDataType.STRING, reward.name()));
  }

  /** The killstreak reward {@code stack} carries, if it is a killstreak item. */
  Optional<Killstreak> streak(ItemStack stack) {
    if (stack.isEmpty() || !stack.hasItemMeta()) {
      return Optional.empty();
    }
    var name =
        stack.getItemMeta().getPersistentDataContainer().get(streak, PersistentDataType.STRING);
    return Optional.ofNullable(name).map(Killstreak::valueOf);
  }

  boolean isCompass(ItemStack stack) {
    return has(stack, compass);
  }

  /** Marks {@code stack} as the dead's "Join next game" item (a kit item too). */
  void tagNextGame(ItemStack stack) {
    tag(stack);
    stack.editMeta(
        meta -> meta.getPersistentDataContainer().set(nextGame, PersistentDataType.BOOLEAN, true));
  }

  boolean isNextGame(ItemStack stack) {
    return has(stack, nextGame);
  }

  /** Marks {@code stack} as the dead's "Change kit layout" item (a kit item too). */
  void tagKitLayout(ItemStack stack) {
    tag(stack);
    stack.editMeta(
        meta -> meta.getPersistentDataContainer().set(kitLayout, PersistentDataType.BOOLEAN, true));
  }

  boolean isKitLayout(ItemStack stack) {
    return has(stack, kitLayout);
  }

  boolean isSelector(ItemStack stack) {
    return has(stack, selector);
  }

  void tagSettings(ItemStack stack) {
    tag(stack);
    stack.editMeta(
        meta -> meta.getPersistentDataContainer().set(settings, PersistentDataType.BOOLEAN, true));
  }

  boolean isSettings(ItemStack stack) {
    return has(stack, settings);
  }

  void tagMapMenu(ItemStack stack) {
    tag(stack);
    stack.editMeta(
        meta -> meta.getPersistentDataContainer().set(mapMenu, PersistentDataType.BOOLEAN, true));
  }

  boolean isMapMenu(ItemStack stack) {
    return has(stack, mapMenu);
  }

  boolean isLeave(ItemStack stack) {
    return has(stack, leave);
  }

  private static boolean has(ItemStack stack, NamespacedKey key) {
    return !stack.isEmpty()
        && stack.hasItemMeta()
        && stack.getItemMeta().getPersistentDataContainer().has(key, PersistentDataType.BOOLEAN);
  }

  boolean isKitItem(ItemStack stack) {
    return !stack.isEmpty()
        && stack.hasItemMeta()
        && stack.getItemMeta().getPersistentDataContainer().has(item, PersistentDataType.BOOLEAN);
  }

  boolean isFuse(ItemStack stack) {
    return !stack.isEmpty()
        && stack.hasItemMeta()
        && stack.getItemMeta().getPersistentDataContainer().has(fuse, PersistentDataType.BOOLEAN);
  }

  /** Marks {@code target} as standing for the bomb {@code bombId}. */
  void tagBomb(Entity target, String bombId) {
    target.getPersistentDataContainer().set(bomb, PersistentDataType.STRING, bombId);
  }

  /** The bomb {@code target} stands for, if it is a bomb entity. */
  Optional<String> bombOf(Entity target) {
    return Optional.ofNullable(
        target.getPersistentDataContainer().get(bomb, PersistentDataType.STRING));
  }

  /** Marks {@code target} as one of the lobby's displays, named {@code part}. */
  void tagLobby(Entity target, String part) {
    target.getPersistentDataContainer().set(lobby, PersistentDataType.STRING, part);
  }

  /** The lobby display part {@code target} is, if it is one. */
  Optional<String> lobbyPart(Entity target) {
    return Optional.ofNullable(
        target.getPersistentDataContainer().get(lobby, PersistentDataType.STRING));
  }
}
