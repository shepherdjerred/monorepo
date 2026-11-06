package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.shepherdjerred.thestorm.core.protection.Protection;
import org.bukkit.Server;
import org.bukkit.World;
import org.junit.jupiter.api.Test;

final class HistoricalClocksTest {
  @Test
  void unloadedChunksAreNeverLoadedByTheClock() {
    var server = mock(Server.class);
    var world = mock(World.class);
    var kit = mock(Kit.class);
    when(server.getWorld("world")).thenReturn(world);
    when(world.isChunkLoaded(4, -3)).thenReturn(false);
    new HistoricalClocks(kit, mock(Protection.class), server).tick();
    verify(world, never()).getBlockAt(anyInt(), anyInt(), anyInt());
  }
}
