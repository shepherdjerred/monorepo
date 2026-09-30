package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.Harm;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import java.util.OptionalInt;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EntityEquipment;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;

/**
 * Disarm (II): knocks the weapon out of the hand of the creature in sight.
 *
 * <p>A player's weapon moves into their own backpack (never onto the ground, so nothing is stolen);
 * with a full backpack there is nothing to do. A monster drops an item it picked up and loses one
 * it spawned with, so Disarm is never a loot farm.
 */
final class Disarm implements Spell {

  /** Vanilla gives picked-up items a drop chance above 1 (always drop, undamaged). */
  private static final float PICKED_UP = 1.0f;

  /** The first backpack slot: slots 0-8 are the hotbar. */
  private static final int BACKPACK_START = 9;

  private static final int BACKPACK_END = 36;

  private final SpellSettings.Range settings;
  private final Toolbox tools;

  Disarm(SpellSettings.Range settings, Toolbox tools) {
    this.settings = settings;
    this.tools = tools;
  }

  @Override
  public SpellKind kind() {
    return SpellKind.DISARM;
  }

  @Override
  public Result<Effect, CastProblem> prepare(Player caster) {
    return Aim.creature(tools, caster, settings.range()).flatMap(target -> disarm(caster, target));
  }

  private Result<Effect, CastProblem> disarm(Player caster, LivingEntity target) {
    if (target instanceof Player victim) {
      var inventory = victim.getInventory();
      var weapon = inventory.getItemInMainHand();
      var slot = freeBackpackSlot(inventory);
      if (weapon.isEmpty() || slot.isEmpty()) {
        return Result.err(CastProblem.noTarget("weapon to knock away"));
      }
      return Result.ok(() -> strike(caster, target, Harm.Blow.none().then(Disarm::stow)));
    }
    var equipment = target.getEquipment();
    if (equipment == null || equipment.getItemInMainHand().isEmpty()) {
      return Result.err(CastProblem.noTarget("weapon to knock away"));
    }
    return Result.ok(
        () -> strike(caster, target, Harm.Blow.none().then(monster -> drop(monster, equipment))));
  }

  private void strike(Player caster, LivingEntity target, Harm.Blow blow) {
    if (tools.harm().strike(caster, target, blow)) {
      flourish(caster, target);
    }
  }

  /** Moves a player's weapon into their own backpack, if there is still room. */
  private static void stow(LivingEntity target) {
    if (!(target instanceof Player victim)) {
      return;
    }
    var inventory = victim.getInventory();
    var slot = freeBackpackSlot(inventory);
    if (slot.isPresent()) {
      inventory.setItem(slot.getAsInt(), inventory.getItemInMainHand());
      inventory.setItemInMainHand(null);
    }
  }

  private static void drop(LivingEntity target, EntityEquipment equipment) {
    ItemStack weapon = equipment.getItemInMainHand();
    if (equipment.getItemInMainHandDropChance() > PICKED_UP) {
      target.getWorld().dropItemNaturally(target.getLocation(), weapon);
    }
    equipment.setItemInMainHand(null);
  }

  private static OptionalInt freeBackpackSlot(PlayerInventory inventory) {
    for (var slot = BACKPACK_START; slot < BACKPACK_END; slot++) {
      var item = inventory.getItem(slot);
      if (item == null || item.isEmpty()) {
        return OptionalInt.of(slot);
      }
    }
    return OptionalInt.empty();
  }

  private void flourish(Player caster, LivingEntity target) {
    tools.fx().line(kind(), caster.getEyeLocation(), Magic.chest(target));
    tools.fx().cast(kind(), Magic.chest(target));
  }
}
