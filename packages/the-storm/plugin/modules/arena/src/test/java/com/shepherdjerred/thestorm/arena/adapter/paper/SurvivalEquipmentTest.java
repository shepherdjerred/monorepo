package com.shepherdjerred.thestorm.arena.adapter.paper;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.function.Consumer;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.inventory.meta.Damageable;
import org.bukkit.inventory.meta.ItemMeta;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

final class SurvivalEquipmentTest {
  private final SurvivalRunner runner = mock(SurvivalRunner.class);
  private final SurvivalItems items = mock(SurvivalItems.class);
  private final SurvivalFeedback feedback = mock(SurvivalFeedback.class);
  private final SurvivalHud hud = mock(SurvivalHud.class);
  private final Player player = mock(Player.class);
  private final PlayerInventory inventory = mock(PlayerInventory.class);
  private final SurvivalEquipment equipment = new SurvivalEquipment(runner);
  private final Map<String, Integer> handPrice = Map.of("IRON_INGOT", 2, "EMERALD", 2);

  SurvivalEquipmentTest() {
    when(runner.items()).thenReturn(items);
    when(runner.feedback()).thenReturn(feedback);
    when(runner.hud()).thenReturn(hud);
    when(player.getInventory()).thenReturn(inventory);
    when(items.spend(player, handPrice)).thenReturn(true);
  }

  @ParameterizedTest
  @EnumSource(
      value = EquipmentSlot.class,
      names = {"HAND", "OFF_HAND"})
  void repairsOwnedShieldInItsOriginalHand(EquipmentSlot slot) {
    var gear = equip(slot, Material.SHIELD, true);
    equipment.repair(player, false);
    verify(gear.meta()).setDamage(0);
    verify(inventory).setItem(slot, gear.item());
    var other = slot == EquipmentSlot.HAND ? EquipmentSlot.OFF_HAND : EquipmentSlot.HAND;
    verify(inventory, never())
        .setItem(org.mockito.ArgumentMatchers.eq(other), any(ItemStack.class));
    verify(items).spend(player, handPrice);
  }

  @Test
  void repairsBothHandsForOnePaymentWithoutMovingEitherItem() {
    var weapon = equip(EquipmentSlot.HAND, Material.DIAMOND_SWORD, true);
    var shield = equip(EquipmentSlot.OFF_HAND, Material.SHIELD, true);
    equipment.repair(player, false);
    verify(weapon.meta()).setDamage(0);
    verify(shield.meta()).setDamage(0);
    verify(inventory).setItem(EquipmentSlot.HAND, weapon.item());
    verify(inventory).setItem(EquipmentSlot.OFF_HAND, shield.item());
    verify(items).spend(player, handPrice);
  }

  @Test
  void armorRepairPreservesSlotsAndLeavesHandsAlone() {
    var chest = equip(EquipmentSlot.CHEST, Material.DIAMOND_CHESTPLATE, true);
    var shield = equip(EquipmentSlot.OFF_HAND, Material.SHIELD, true);
    var price = Map.of("IRON_INGOT", 4, "EMERALD", 4);
    when(items.spend(player, price)).thenReturn(true);
    equipment.repair(player, true);
    verify(chest.meta()).setDamage(0);
    verify(inventory).setItem(EquipmentSlot.CHEST, chest.item());
    verify(shield.meta(), never()).setDamage(0);
    verify(inventory, never())
        .setItem(org.mockito.ArgumentMatchers.eq(EquipmentSlot.OFF_HAND), any(ItemStack.class));
    verify(items).spend(player, price);
  }

  @Test
  void foreignShieldIsNotRepairedOrCharged() {
    var shield = equip(EquipmentSlot.OFF_HAND, Material.SHIELD, false);
    equipment.repair(player, false);
    verify(shield.meta(), never()).setDamage(0);
    verify(items, never()).spend(any(Player.class), any());
    verifyNoInteractions(feedback, hud);
  }

  @Test
  void failedPaymentLeavesBothHandsDamaged() {
    var weapon = equip(EquipmentSlot.HAND, Material.DIAMOND_SWORD, true);
    var shield = equip(EquipmentSlot.OFF_HAND, Material.SHIELD, true);
    when(items.spend(player, handPrice)).thenReturn(false);
    equipment.repair(player, false);
    verify(weapon.meta(), never()).setDamage(0);
    verify(shield.meta(), never()).setDamage(0);
    verify(inventory, never()).setItem(any(EquipmentSlot.class), any(ItemStack.class));
    verifyNoInteractions(feedback, hud);
  }

  @Test
  void undamagedShieldIsNotCharged() {
    var shield = equip(EquipmentSlot.OFF_HAND, Material.SHIELD, true);
    when(shield.meta().getDamage()).thenReturn(0);
    equipment.repair(player, false);
    verify(items, never()).spend(any(Player.class), any());
    verify(shield.meta(), never()).setDamage(0);
    verifyNoInteractions(feedback, hud);
  }

  private Gear equip(EquipmentSlot slot, Material material, boolean owned) {
    var item = mock(ItemStack.class);
    var meta = mock(Damageable.class);
    when(inventory.getItem(slot)).thenReturn(item);
    when(item.getType()).thenReturn(material);
    when(item.getItemMeta()).thenReturn(meta);
    when(meta.getDamage()).thenReturn(80);
    when(items.owns(item)).thenReturn(owned);
    when(items.weapon(item)).thenReturn(material == Material.DIAMOND_SWORD);
    doAnswer(
            invocation -> {
              Consumer<? super ItemMeta> editor = invocation.getArgument(0);
              editor.accept(meta);
              return true;
            })
        .when(item)
        .editMeta(any());
    return new Gear(item, meta);
  }

  private record Gear(ItemStack item, Damageable meta) {}
}
