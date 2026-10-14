package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.core.world.AuditedBlockChanges;
import com.shepherdjerred.thestorm.rwf.RwfHarness;
import com.shepherdjerred.thestorm.rwf.adapter.content.MapFile;
import com.shepherdjerred.thestorm.rwf.adapter.content.MapSource;
import com.shepherdjerred.thestorm.rwf.app.BattleSoundLog;
import com.shepherdjerred.thestorm.rwf.app.TacticalReportLog;
import com.shepherdjerred.thestorm.rwf.app.map.MapResourceRegistry;
import com.shepherdjerred.thestorm.rwf.app.map.MapResources;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.concurrent.CompletableFuture;
import java.util.random.RandomGenerator;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;

class MapWorldTest {
  @TempDir Path directory;

  @Test
  void anOldResourceCompletionCannotActivateTerrainPreparedAfterRelease() {
    try (var harness = RwfHarness.prepare(directory)) {
      var plugin = MockBukkit.createMockPlugin();
      var context =
          new PaperContext(
              new PaperContext.Parts(
                  plugin,
                  new PaperScheduler(plugin),
                  new DirectComputePool(),
                  harness.clock,
                  RandomGenerator.of("L64X128MixRandom"),
                  harness.lobbyWorld,
                  harness.rwf,
                  new AuditedBlockChanges(_ -> {}),
                  com.shepherdjerred.thestorm.core.analytics.ProductAnalytics.disabled(),
                  new BattleSoundLog(harness.clock),
                  new TacticalReportLog(harness.clock),
                  new com.shepherdjerred.thestorm.core.players.PlayerVisibilityControl(plugin)));
      var resources = new MapResourceRegistry();
      var requests = new ArrayList<CompletableFuture<Void>>();
      var subscription =
          resources.register(
              new MapResources.Handler() {
                @Override
                public CompletableFuture<Void> prepare(String mapId) {
                  var future = new CompletableFuture<Void>();
                  requests.add(future);
                  return future;
                }

                @Override
                public void release(String mapId) {}
              });
      var folder = directory.resolve("rwf/maps/training-yard");
      var source =
          new MapSource(
              ConfigFiles.load(folder.resolve("map.yml"), MapFile.class).toDefinition(),
              folder,
              harness.server::createBlockData);
      var map = new MapWorld(context, source, new RwfHarness.CountingChunks(), resources);
      try {
        var stale = new ArrayList<Boolean>();
        map.prepare(stale::add);
        harness.until(() -> requests.size() == 1);
        map.release();
        var visit = new ArrayList<Boolean>();
        map.prepareVisit(visit::add);
        harness.until(map::visitReady);
        assertThat(visit).containsExactly(true);
        assertThat(map.ready()).isFalse();
        requests.getFirst().complete(null);
        harness.tick(Duration.ofSeconds(1));
        assertThat(stale).isEmpty();
        assertThat(map.ready()).isFalse();
        var selected = new ArrayList<Boolean>();
        map.activate(selected::add);
        assertThat(requests).hasSize(2);
        assertThat(map.ready()).isFalse();
        requests.getLast().complete(null);
        harness.until(map::ready);
        assertThat(selected).containsExactly(true);
      } finally {
        map.release();
        subscription.close();
      }
    }
  }
}
