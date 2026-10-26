package com.shepherdjerred.thestorm.rwfbots.adapter.citizens;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.paper.Invulnerability;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

final class BodyStateTest {
  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void replacementKeepsIndependentEquipmentCopiesAndSelectedSlot() {
    var server = MockBukkit.mock();
    var old = server.addPlayer("Before");
    old.getInventory().setItem(2, ItemStack.of(Material.DIAMOND, 7));
    old.getInventory().setHelmet(ItemStack.of(Material.IRON_HELMET));
    old.getInventory().setItemInOffHand(ItemStack.of(Material.SHIELD));
    old.getInventory().setHeldItemSlot(2);
    var state = BodyState.Gear.capture(old);
    // Mutating the discarded body's inventory cannot mutate the transfer's saved equipment.
    requireNonNull(old.getInventory().getItem(2)).setAmount(1);
    var replacement = server.addPlayer("After");

    state.apply(replacement);

    assertThat(replacement.getInventory().getItem(2)).isEqualTo(ItemStack.of(Material.DIAMOND, 7));
    assertThat(replacement.getInventory().getHelmet())
        .isEqualTo(ItemStack.of(Material.IRON_HELMET));
    assertThat(replacement.getInventory().getItemInOffHand())
        .isEqualTo(ItemStack.of(Material.SHIELD));
    assertThat(replacement.getInventory().getHeldItemSlot()).isEqualTo(2);
  }

  @Test
  void replacementKeepsSpectatorFlagsAndFlight() {
    var server = MockBukkit.mock();
    var old = server.addPlayer("Before");
    old.setGameMode(GameMode.ADVENTURE);
    old.setAllowFlight(true);
    old.setFlying(true);
    old.setInvulnerable(true);
    old.setCollidable(false);
    old.setInvisible(true);
    var flags = BodyState.Flags.capture(old);
    var flight = BodyState.Flight.capture(old);
    var replacement = server.addPlayer("After");

    replacement.setGameMode(flags.gameMode());
    flags.apply(replacement);
    flight.apply(replacement);

    assertThat(replacement.getGameMode()).isEqualTo(GameMode.ADVENTURE);
    assertThat(replacement.getAllowFlight()).isTrue();
    assertThat(replacement.isFlying()).isTrue();
    assertThat(Invulnerability.marked(replacement)).isTrue();
    assertThat(replacement.isCollidable()).isFalse();
    assertThat(replacement.isInvisible()).isTrue();
  }
}
