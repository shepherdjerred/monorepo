package com.shepherdjerred.thestorm.arena.adapter.paper;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.shepherdjerred.thestorm.core.status.PublicGameDirectory;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;

final class ArenasSealedTest {

  @Test
  void aSealedWorldRefusesTheJoinAndAnOpenWorldDoesNot() {
    var runner = mock(ArenaRunner.class);
    when(runner.id()).thenReturn("settlement");
    when(runner.handle(any())).thenReturn(Optional.empty());
    var snapshots = mock(Snapshots.class);
    when(snapshots.refusal(any())).thenReturn(Optional.empty());
    var sealed = new SealedWorlds();
    sealed.seal("creative");
    var arenas = new Arenas(List.of(runner), snapshots, new PublicGameDirectory(), sealed);
    arenas.ready();
    var world = mock(World.class);
    when(world.getName()).thenReturn("creative");
    var player = mock(Player.class);
    when(player.getWorld()).thenReturn(world);
    when(player.getUniqueId()).thenReturn(UUID.randomUUID());
    when(player.getName()).thenReturn("Ada");

    arenas.join(player, runner);
    verify(runner, never()).handle(any());

    when(world.getName()).thenReturn("world");
    arenas.join(player, runner);
    verify(runner).handle(any());
  }
}
