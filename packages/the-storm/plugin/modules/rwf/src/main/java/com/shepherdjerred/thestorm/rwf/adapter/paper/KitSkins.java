// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/SkinnerAbility.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.destroystokyo.paper.profile.ProfileProperty;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Ghost;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Wraith;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/**
 * The Skinner's dressing: how each victim looked when they died (their skin, and the armour they
 * wore, or a Trooper's for a Ghost or Wraith, whose own armour Red Warfare never showed), and the
 * Skinner wearing it. The skin is the Skinner's profile texture; the armour is sent to everyone off
 * its team in place of its own, again every second as Red Warfare's equipment packets were sent
 * again. Its own skin and armour come back when it undresses or leaves. Main thread only.
 */
final class KitSkins {

  private static final String TEXTURES = "textures";

  private static final Set<String> HIDDEN_ARMOUR = Set.of(Ghost.ID, Wraith.ID);

  private static final EquipmentSlot[] ARMOUR = {
    EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET
  };

  /**
   * How a victim looked.
   *
   * @param textures their skin, if their profile has one
   * @param armour what they wore, by slot
   */
  private record Look(Optional<ProfileProperty> textures, Map<EquipmentSlot, ItemStack> armour) {}

  private final MatchRunner runner;
  private final PaperContext context;
  private final KitFactory kits;
  private final Map<CombatantId, Look> looks = new HashMap<>();
  private final Map<UUID, Optional<ProfileProperty>> own = new HashMap<>();
  private final Map<UUID, Map<EquipmentSlot, ItemStack>> worn = new HashMap<>();
  private long ticks;

  KitSkins(MatchRunner runner, PaperContext context, KitFactory kits) {
    this.runner = runner;
    this.context = context;
    this.kits = kits;
  }

  /** Remembers how {@code victim} looks now. */
  void snap(CombatantId victim) {
    var member = runner.member(victim);
    runner
        .entity(victim)
        .ifPresent(
            player -> {
              var armour = new EnumMap<EquipmentSlot, ItemStack>(EquipmentSlot.class);
              var kit = member.flatMap(Combatant::kit);
              if (kit.filter(HIDDEN_ARMOUR::contains).isPresent()) {
                for (var spec : KitBook.TROOPER.armor()) {
                  armour.put(
                      KitFactory.equipmentSlot(spec.slot().orElseThrow()),
                      kits.kitItem(spec, Optional.empty()));
                }
              } else {
                for (var slot : ARMOUR) {
                  armour.put(slot, player.getInventory().getItem(slot).clone());
                }
              }
              looks.put(victim, new Look(textures(player), armour));
            });
  }

  /** {@code skinner} wears how {@code of} looked, or its own look again when empty. */
  void wear(Player skinner, Optional<CombatantId> of) {
    if (of.isEmpty()) {
      undress(skinner);
      return;
    }
    var look = looks.get(of.orElseThrow());
    if (look == null) {
      return;
    }
    own.putIfAbsent(skinner.getUniqueId(), textures(skinner));
    context.guarded("put on a skin", () -> texture(skinner, look.textures()));
    worn.put(skinner.getUniqueId(), look.armour());
    show(skinner, look.armour());
  }

  /** {@code skinner} looks like itself again. */
  void undress(Player skinner) {
    var textures = own.remove(skinner.getUniqueId());
    if (textures != null) {
      context.guarded("take off a skin", () -> texture(skinner, textures));
    }
    if (worn.remove(skinner.getUniqueId()) != null) {
      var real = new EnumMap<EquipmentSlot, ItemStack>(EquipmentSlot.class);
      for (var slot : ARMOUR) {
        real.put(slot, skinner.getInventory().getItem(slot));
      }
      show(skinner, real);
    }
  }

  /** Once a tick: every second the worn armour is sent again. */
  void tick() {
    ticks++;
    if (ticks % 20 != 0) {
      return;
    }
    for (var entry : Map.copyOf(worn).entrySet()) {
      var skinner = context.server().getPlayer(entry.getKey());
      if (skinner != null) {
        show(skinner, entry.getValue());
      }
    }
  }

  /** The match reset: everyone looks like themselves and nothing is remembered. */
  void reset() {
    for (var id : Set.copyOf(own.keySet())) {
      var player = context.server().getPlayer(id);
      if (player != null) {
        undress(player);
      }
    }
    own.clear();
    worn.clear();
    looks.clear();
  }

  /** Sends {@code armour} on {@code skinner} to every player off its team. */
  private void show(Player skinner, Map<EquipmentSlot, ItemStack> armour) {
    Map<EquipmentSlot, @Nullable ItemStack> items = new EnumMap<>(EquipmentSlot.class);
    items.putAll(armour);
    var team = runner.memberOf(skinner.getUniqueId()).flatMap(Combatant::team);
    for (var viewer : context.server().getOnlinePlayers()) {
      if (viewer.equals(skinner) || !viewer.getWorld().equals(skinner.getWorld())) {
        continue;
      }
      var mate =
          team.isPresent()
              && runner.memberOf(viewer.getUniqueId()).flatMap(Combatant::team).equals(team);
      if (!mate) {
        context.guarded("show worn armour", () -> viewer.sendEquipmentChange(skinner, items));
      }
    }
  }

  private static Optional<ProfileProperty> textures(Player player) {
    return player.getPlayerProfile().getProperties().stream()
        .filter(property -> TEXTURES.equals(property.getName()))
        .findFirst();
  }

  private static void texture(Player player, Optional<ProfileProperty> textures) {
    var profile = player.getPlayerProfile();
    profile.removeProperty(TEXTURES);
    textures.ifPresent(profile::setProperty);
    player.setPlayerProfile(profile);
  }
}
