package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.Protection;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.AbstractHorse;
import org.bukkit.entity.Boat;
import org.bukkit.entity.Minecart;
import org.bukkit.entity.Pig;
import org.bukkit.entity.Player;
import org.bukkit.entity.Strider;
import org.junit.jupiter.api.Test;

final class StargateMountTest {
  @Test
  void recognisesTheSupportedVehicleFamilies() {
    assertThat(StargateMount.supported(mock(Boat.class))).isTrue();
    assertThat(StargateMount.supported(mock(Minecart.class))).isTrue();
    assertThat(StargateMount.supported(mock(AbstractHorse.class))).isTrue();
    assertThat(StargateMount.supported(mock(Pig.class))).isTrue();
    assertThat(StargateMount.supported(mock(Strider.class))).isTrue();
    assertThat(StargateMount.supported(mock(Player.class))).isFalse();
  }

  @Test
  void refusesIfAPlayerMountsWhileAnUnmountedTripIsPreparing() {
    var player = mock(Player.class);
    var destination = new Location(mock(World.class), 1, 70, 1);
    when(player.getVehicle()).thenReturn(mock(Boat.class));
    assertThat(
            StargateMount.transport(null, mock(Protection.class)).move(player, destination).join())
        .isFalse();
    verify(player, never()).teleportAsync(destination);
  }

  @Test
  void detectsThePortalWhenTheBoatEdgeTouchesBeforeItsCenter() {
    var boat = mock(Boat.class);
    var world = mock(World.class);
    when(boat.getWidth()).thenReturn(1.4);
    when(boat.getHeight()).thenReturn(0.6);
    var position = new Location(world, 400.5, 71, 1.5);
    assertThat(StargateMount.touchingPortal(boat, position, loc -> loc.getBlockZ() == 0))
        .isPresent();
    assertThat(
            StargateMount.touchingPortal(
                boat, new Location(world, 400.5, 71, 2.5), loc -> loc.getBlockZ() == 0))
        .isEmpty();
  }

  @Test
  void carriesTheRiderOnlyWhenTheWholeLandingIsSafe() {
    var world = mock(World.class);
    var boat = mock(Boat.class);
    var player = mock(Player.class);
    var block = mock(Block.class);
    var protection = mock(Protection.class);
    var destination = new Location(world, 10.5, 70, 10.5);
    when(player.isOnline()).thenReturn(true);
    when(player.getUniqueId()).thenReturn(new UUID(0, 1));
    when(player.getVehicle()).thenReturn(boat);
    when(player.getWidth()).thenReturn(0.6);
    when(player.getHeight()).thenReturn(1.8);
    when(boat.isValid()).thenReturn(true);
    when(boat.getWidth()).thenReturn(1.4);
    when(boat.getHeight()).thenReturn(0.6);
    when(boat.getPassengers()).thenReturn(List.of(player));
    when(world.getMinHeight()).thenReturn(-64);
    when(world.getMaxHeight()).thenReturn(320);
    when(world.isChunkLoaded(anyInt(), anyInt())).thenReturn(true);
    when(world.getBlockAt(anyInt(), anyInt(), anyInt())).thenReturn(block);
    when(block.isPassable()).thenReturn(true);
    when(block.getType()).thenReturn(Material.AIR);
    when(block.getLocation()).thenReturn(destination);
    when(protection.check(any(), any(), any())).thenReturn(Decision.allowed());
    when(boat.teleportAsync(destination)).thenReturn(CompletableFuture.completedFuture(true));
    assertThat(StargateMount.transport(boat, protection).move(player, destination).join()).isTrue();
    when(block.getType()).thenReturn(Material.LAVA);
    assertThat(StargateMount.transport(boat, protection).move(player, destination).join())
        .isFalse();
    when(block.getType()).thenReturn(Material.AIR);
    when(protection.check(any(), any(), any()))
        .thenReturn(new Decision.Denied(Component.text("blocked")));
    assertThat(StargateMount.transport(boat, protection).move(player, destination).join())
        .isFalse();
    verify(boat).teleportAsync(destination);
  }

  @Test
  void refusesAnUnsupportedOrChangedMountWithoutMovingIt() {
    var boat = mock(Boat.class);
    var player = mock(Player.class);
    var destination = new Location(mock(World.class), 1, 70, 1);
    when(player.isOnline()).thenReturn(true);
    when(boat.isValid()).thenReturn(true);
    assertThat(
            StargateMount.transport(boat, mock(Protection.class)).move(player, destination).join())
        .isFalse();
    verify(boat, never()).teleportAsync(destination);
  }
}
