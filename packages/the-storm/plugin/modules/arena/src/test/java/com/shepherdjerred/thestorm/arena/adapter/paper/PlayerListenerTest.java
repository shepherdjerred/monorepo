package com.shepherdjerred.thestorm.arena.adapter.paper;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.shepherdjerred.thestorm.arena.domain.arena.ArenaDefinition;
import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import java.time.Instant;
import java.time.InstantSource;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.block.Container;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

final class PlayerListenerTest {
  private final PaperContext context = mock(PaperContext.class);
  private final Arenas arenas = mock(Arenas.class);
  private final ArenaCommands commands = mock(ArenaCommands.class);
  private final ArenaRunner runner = mock(ArenaRunner.class);
  private final ArenaWorld world = mock(ArenaWorld.class);
  private final ArenaDefinition definition = mock(ArenaDefinition.class);
  private final Player player = mock(Player.class);
  private final Block block = mock(Block.class);
  private final Location location = mock(Location.class);
  private final UUID id = UUID.fromString("503bc928-39c8-405a-9f27-ab6d55f06578");
  private final PlayerListener listener;

  PlayerListenerTest() {
    when(arenas.snapshots()).thenReturn(mock(Snapshots.class));
    when(player.getUniqueId()).thenReturn(id);
    when(block.getLocation()).thenReturn(location);
    when(block.getX()).thenReturn(1);
    when(block.getY()).thenReturn(2);
    when(block.getZ()).thenReturn(3);
    when(runner.world()).thenReturn(world);
    when(world.contains(location)).thenReturn(true);
    when(world.definition()).thenReturn(definition);
    when(definition.classSigns()).thenReturn(Map.of());
    when(definition.readyBlock()).thenReturn(new BlockPos(4, 5, 6));
    listener = new PlayerListener(context, arenas, commands, mock(ItemGuard.class));
  }

  @ParameterizedTest
  @EnumSource(
      value = EquipmentSlot.class,
      names = {"HAND", "OFF_HAND"})
  void deniesMemberContainerAccessForEitherHand(EquipmentSlot hand) {
    when(arenas.arrived(id)).thenReturn(Optional.of(runner));
    container();
    var event = interact(hand);
    listener.onInteract(event);
    verify(event).setUseInteractedBlock(Event.Result.DENY);
    verifyNoInteractions(commands);
  }

  @ParameterizedTest
  @EnumSource(
      value = EquipmentSlot.class,
      names = {"HAND", "OFF_HAND"})
  void deniesOutsiderContainersInRunningArenasForEitherHand(EquipmentSlot hand) {
    when(arenas.runningAt(location)).thenReturn(Optional.of(runner));
    container();
    var event = interact(hand);
    listener.onInteract(event);
    verify(event).setUseInteractedBlock(Event.Result.DENY);
    verifyNoInteractions(commands);
  }

  @Test
  void offHandReadyClickDeniesBlockUseWithoutTogglingReady() {
    when(arenas.arrived(id)).thenReturn(Optional.of(runner));
    when(definition.readyBlock()).thenReturn(new BlockPos(1, 2, 3));
    var event = interact(EquipmentSlot.OFF_HAND);
    listener.onInteract(event);
    verify(event).setUseInteractedBlock(Event.Result.DENY);
    verifyNoInteractions(commands);
  }

  @Test
  void offHandClassSignDeniesBlockUseWithoutChoosingClass() {
    when(arenas.arrived(id)).thenReturn(Optional.of(runner));
    when(definition.classSigns()).thenReturn(Map.of("knight", new BlockPos(1, 2, 3)));
    var event = interact(EquipmentSlot.OFF_HAND);
    listener.onInteract(event);
    verify(event).setUseInteractedBlock(Event.Result.DENY);
    verifyNoInteractions(commands);
  }

  @Test
  void duplicateMainHandReadyEventsToggleOnlyOnce() {
    when(arenas.arrived(id)).thenReturn(Optional.of(runner));
    when(definition.readyBlock()).thenReturn(new BlockPos(1, 2, 3));
    when(context.time()).thenReturn(InstantSource.fixed(Instant.parse("2026-10-05T00:00:00Z")));
    listener.onInteract(interact(EquipmentSlot.HAND));
    listener.onInteract(interact(EquipmentSlot.HAND));
    verify(commands).ready(player);
  }

  private void container() {
    var container = mock(Container.class);
    when(container.getInventory()).thenReturn(mock(Inventory.class));
    when(block.getState()).thenReturn(container);
  }

  private PlayerInteractEvent interact(EquipmentSlot hand) {
    var event = mock(PlayerInteractEvent.class);
    when(event.getPlayer()).thenReturn(player);
    when(event.getClickedBlock()).thenReturn(block);
    when(event.getAction()).thenReturn(Action.RIGHT_CLICK_BLOCK);
    when(event.getHand()).thenReturn(hand);
    return event;
  }
}
