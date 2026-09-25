package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.SettledLand;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.qol.domain.QolConfig;
import com.shepherdjerred.thestorm.qol.domain.rtp.BlockPoint;
import com.shepherdjerred.thestorm.qol.domain.rtp.BorderRoom;
import com.shepherdjerred.thestorm.qol.domain.rtp.CandidateFilter;
import com.shepherdjerred.thestorm.qol.domain.rtp.SearchRing;
import com.shepherdjerred.thestorm.qol.domain.rtp.WildSpotPicker;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import java.util.random.RandomGenerator;
import org.bukkit.World;

/** Loads two batches of chunks and keeps the farthest safe column. */
final class RtpSearch {

  private final WildSpotPicker picker;
  private final Scheduler scheduler;
  private final int minGap;
  private final int band;
  private final int borderMargin;

  RtpSearch(QolConfig config, Scheduler scheduler) {
    this.picker = new WildSpotPicker(config.batchSize(), config.nearBestHundredths());
    this.scheduler = scheduler;
    this.minGap = config.minGap();
    this.band = config.band();
    this.borderMargin = config.borderMargin();
  }

  /** Calls {@code done} on the main thread with a block to stand on, or empty. */
  void find(Request request, RandomGenerator random, Consumer<Optional<Spot>> done) {
    var ring = ring(request);
    if (ring.isEmpty()) {
      done.accept(Optional.empty());
      return;
    }
    attempt(new Pass(request, ring.get(), done), 0, random);
  }

  private void attempt(Pass pass, int tried, RandomGenerator random) {
    if (tried >= 2) {
      pass.done().accept(Optional.empty());
      return;
    }
    var samples = shift(pass.request().site().spawn(), picker.batch(pass.ring(), random));
    var _ =
        load(pass.request().site().world(), samples)
            .thenRunAsync(() -> choose(pass, samples, tried, random), scheduler.mainThread());
  }

  private void choose(Pass pass, List<BlockPoint> samples, int tried, RandomGenerator random) {
    var request = pass.request();
    var chosen = picker.rank(samples, ground(request), request.target().repel(), random);
    if (chosen.isEmpty()) {
      attempt(pass, tried + 1, random);
      return;
    }
    deliver(pass, chosen.get(), tried, random);
  }

  private void deliver(Pass pass, BlockPoint point, int tried, RandomGenerator random) {
    var feet = SafeColumn.surface(pass.request().site().world(), point.x(), point.z());
    if (feet.isEmpty()) {
      attempt(pass, tried + 1, random);
      return;
    }
    pass.done().accept(Optional.of(new Spot(point.x(), feet.get(), point.z())));
  }

  private Ground ground(Request request) {
    return new Ground(
        request.site().world(), request.target(), claimKeys(request.target().claims()));
  }

  private Optional<SearchRing> ring(Request request) {
    var site = request.site();
    var room =
        BorderRoom.maxRadius(site.spawn(), site.borderCenter(), site.diameter(), borderMargin);
    var farthest = SearchRing.farthest(site.spawn(), centers(request.target().claims()));
    return SearchRing.around(farthest, minGap, band, room);
  }

  private static CompletableFuture<Void> load(World world, List<BlockPoint> samples) {
    var loads = new ArrayList<CompletableFuture<?>>();
    for (var sample : samples) {
      loads.add(world.getChunkAtAsync(sample.chunkX(), sample.chunkZ()));
    }
    return CompletableFuture.allOf(loads.toArray(CompletableFuture[]::new));
  }

  private static List<BlockPoint> shift(BlockPoint spawn, List<BlockPoint> offsets) {
    var shifted = new ArrayList<BlockPoint>(offsets.size());
    for (var offset : offsets) {
      shifted.add(new BlockPoint(spawn.x() + offset.x(), spawn.z() + offset.z()));
    }
    return List.copyOf(shifted);
  }

  private static List<BlockPoint> centers(List<SettledLand.Chunk> claims) {
    var centers = new ArrayList<BlockPoint>(claims.size());
    for (var claim : claims) {
      centers.add(new BlockPoint(claim.x() * 16 + 8, claim.z() * 16 + 8));
    }
    return List.copyOf(centers);
  }

  private static Set<Long> claimKeys(List<SettledLand.Chunk> claims) {
    var keys = new HashSet<Long>();
    for (var claim : claims) {
      keys.add(key(claim.x(), claim.z()));
    }
    return keys;
  }

  private static long key(int x, int z) {
    return ((long) x << 32) | (z & 0xFFFF_FFFFL);
  }

  /** Where the search runs. */
  record Site(World world, BlockPoint spawn, BlockPoint borderCenter, int diameter) {}

  /** What the landing must avoid and match. */
  record Target(Optional<String> biome, List<SettledLand.Chunk> claims, List<BlockPoint> repel) {}

  /** One search. */
  record Request(Site site, Target target) {}

  private record Pass(Request request, SearchRing ring, Consumer<Optional<Spot>> done) {}

  /** A block to stand on. */
  record Spot(int x, int y, int z) {}

  private static final class Ground implements CandidateFilter.Reject {

    private final World world;
    private final Target target;
    private final Set<Long> claims;

    private Ground(World world, Target target, Set<Long> claims) {
      this.world = world;
      this.target = target;
      this.claims = claims;
    }

    @Override
    public boolean claimed(BlockPoint point) {
      return claims.contains(key(point.chunkX(), point.chunkZ()));
    }

    @Override
    public boolean unsafe(BlockPoint point) {
      return SafeColumn.surface(world, point.x(), point.z()).isEmpty();
    }

    @Override
    public boolean wrongBiome(BlockPoint point) {
      var feet = SafeColumn.surface(world, point.x(), point.z());
      if (feet.isEmpty()) {
        return true;
      }
      return !matches(point, feet.get());
    }

    private boolean matches(BlockPoint point, int y) {
      var biome = world.getBiome(point.x(), y, point.z()).getKey().getKey();
      if (target.biome().isEmpty()) {
        return !biome.contains("ocean");
      }
      return biome.equals(target.biome().get());
    }
  }
}
