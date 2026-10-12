package com.shepherdjerred.thestorm.arena.adapter.paper;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import org.junit.jupiter.api.Test;

final class ArenasStartupTest {
  @Test
  void idleRunnersCannotReleasePreloadTicketsBeforeStartupFinishes() {
    var runner = mock(ArenaRunner.class);
    when(runner.id()).thenReturn("settlement");
    var arenas = new Arenas(List.of(runner), mock(Snapshots.class));
    arenas.tick();
    verify(runner, never()).tick();
    arenas.ready();
    arenas.tick();
    verify(runner).tick();
  }
}
