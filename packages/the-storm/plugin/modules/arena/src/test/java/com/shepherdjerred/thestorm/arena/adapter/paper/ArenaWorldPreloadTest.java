package com.shepherdjerred.thestorm.arena.adapter.paper;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.shepherdjerred.thestorm.arena.domain.arena.ArenaDefinition;
import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.geometry.ChunkPos;
import com.shepherdjerred.thestorm.arena.domain.geometry.Cuboid;
import java.util.ArrayDeque;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Chunk;
import org.bukkit.World;
import org.junit.jupiter.api.Test;

final class ArenaWorldPreloadTest {
  private static final ChunkPos POSITION = new ChunkPos(0, 0);

  @Test
  void holdsTheChunkBeforePapersTemporaryLoadTicketExpires() {
    var fixture = new Fixture();
    var held = new AtomicBoolean();
    doAnswer(
            invocation -> {
              held.set(true);
              return null;
            })
        .when(fixture.chunks)
        .keep(fixture.world, List.of(POSITION));
    var startup = fixture.arena.startupPreload();

    // Paper completes on the server thread. Its temporary ticket protects this callback,
    // but a task deferred to another tick can see the chunk unloaded again.
    fixture.loaded.set(true);
    fixture.load.complete(mock(Chunk.class));
    var heldDuringCompletion = held.get();
    fixture.loaded.set(heldDuringCompletion);
    fixture.drain();
    startup.join();

    assertTrue(heldDuringCompletion, "Hold the chunk before the load callback returns");
    assertTrue(startup.isDone());
    assertFalse(startup.isCompletedExceptionally());
    assertTrue(fixture.arena.chunksReady());
    verify(fixture.world).getChunkAtAsync(0, 0, false);
  }

  @Test
  void missingChunksKeepAdmissionClosedWithoutTakingTickets() {
    var fixture = new Fixture();
    var startup = fixture.arena.startupPreload();
    fixture.load.complete(null);
    fixture.drain();

    assertTrue(startup.isCompletedExceptionally());
    assertTrue(fixture.arena.preloadFailed());
    assertFalse(fixture.arena.chunksReady());
    verify(fixture.chunks, never()).keep(any(), any());
  }

  @Test
  void cancellingAPendingLoadCannotTakeALateTicket() {
    var fixture = new Fixture();
    var startup = fixture.arena.startupPreload();
    fixture.arena.cancelPreload();
    fixture.loaded.set(true);
    fixture.load.complete(mock(Chunk.class));
    fixture.drain();

    assertTrue(startup.isCompletedExceptionally());
    assertFalse(fixture.arena.chunksReady());
    verify(fixture.chunks, never()).keep(any(), any());
    verify(fixture.chunks, never()).release(any(), any());
  }

  private static final class Fixture {
    final World world = mock(World.class);
    final ChunkKeeper chunks = mock(ChunkKeeper.class);
    final CompletableFuture<Chunk> load = new CompletableFuture<>();
    final AtomicBoolean loaded = new AtomicBoolean();
    final ArrayDeque<Runnable> scheduled = new ArrayDeque<>();
    final ArenaWorld arena;

    Fixture() {
      var definition = mock(ArenaDefinition.class);
      when(definition.id()).thenReturn("settlement");
      when(definition.region())
          .thenReturn(new Cuboid(new BlockPos(0, 0, 0), new BlockPos(15, 15, 15)));
      var context = mock(PaperContext.class);
      when(context.mainThread()).thenReturn(scheduled::add);
      when(context.logger()).thenReturn(mock(ComponentLogger.class));
      var parts = mock(ArenaWorld.Parts.class);
      when(parts.context()).thenReturn(context);
      when(parts.chunks()).thenReturn(chunks);
      when(world.getChunkAtAsync(0, 0, false)).thenReturn(load);
      when(world.isChunkLoaded(0, 0)).thenAnswer(invocation -> loaded.get());
      arena = new ArenaWorld(definition, world, parts);
    }

    void drain() {
      while (!scheduled.isEmpty()) {
        scheduled.remove().run();
      }
    }
  }
}
