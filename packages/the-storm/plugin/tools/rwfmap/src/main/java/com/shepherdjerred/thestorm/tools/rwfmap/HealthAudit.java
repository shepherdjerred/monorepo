package com.shepherdjerred.thestorm.tools.rwfmap;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import tools.jackson.databind.json.JsonMapper;

/** Offline ordinary-health reachability, independent of runtime travel-time path selection. */
public final class HealthAudit {
  /** Twenty ordinary health points, retaining one point after the entire route. */
  public static final int HEALTH_BUDGET = 19;

  private static final JsonMapper JSON = JsonMapper.builder().build();

  public record Worker(int node, int minimumDamageWithinBudget) {}

  public record Site(
      String spawn,
      String bomb,
      int canonicalNode,
      int canonicalDamageWithinBudget,
      List<Worker> workers,
      boolean anyWorkerSafe,
      boolean allWorkersSafe) {
    public Site {
      workers = List.copyOf(workers);
    }
  }

  public record Report(
      String map,
      int healthBudget,
      int nodes,
      int edges,
      List<Site> sites,
      boolean everyObjectiveHasSafeWorker,
      boolean everySelectedWorkerSafe) {
    public Report {
      sites = List.copyOf(sites);
    }

    public boolean passed() {
      return !sites.isEmpty() && everyObjectiveHasSafeWorker && everySelectedWorkerSafe;
    }

    public String json() {
      return JSON.writerWithDefaultPrettyPrinter().writeValueAsString(this);
    }
  }

  private HealthAudit() {}

  /** Reads the committed artifact and binds it to the actual authored terrain and site catalog. */
  public static Report verify(MapFolder map) {
    NavArtifact nav;
    try {
      nav =
          switch (NavCodec.decode(Files.readAllBytes(map.navFile()))) {
            case Result.Ok(var value) -> value;
            case Result.Err(var error) -> throw new IllegalArgumentException(error.message());
          };
    } catch (IOException error) {
      throw new UncheckedIOException(
          "Required navigation file could not be read: " + map.navFile(), error);
    }
    if (!nav.mapId().equals(map.id())
        || !nav.blocksSha256().equals(map.schematic().sha256())
        || !nav.sites().equals(Sites.of(map.definition()))) {
      throw new IllegalArgumentException(
          "health audit navigation does not match the authored map: " + map.id());
    }
    if (nav.generatorVersion() != MapBaker.GENERATOR_VERSION) {
      throw new IllegalArgumentException(
          "health audit navigation is stale; bake " + map.id() + " first");
    }
    return of(nav);
  }

  static Report of(NavArtifact nav) {
    if (nav.sites().spawns().isEmpty() || nav.sites().bombs().isEmpty()) {
      throw new IllegalArgumentException(
          "health audit requires authored spawns and bomb objectives");
    }
    var results = new ArrayList<Site>();
    for (var spawn : nav.sites().spawns()) {
      var source =
          nav.graph()
              .nodeAt(spawn.cell())
              .orElseThrow(
                  () ->
                      new IllegalArgumentException(
                          "health audit spawn is not navigable: " + spawn.name()));
      var damage = minimumDamage(nav.graph(), source, HEALTH_BUDGET);
      for (var bomb : nav.sites().bombs()) results.add(site(nav, spawn.name(), bomb, damage));
    }
    return new Report(
        nav.mapId(),
        HEALTH_BUDGET,
        nav.graph().nodeCount(),
        nav.graph().edgeCount(),
        results,
        results.stream().allMatch(Site::anyWorkerSafe),
        results.stream().allMatch(Site::allWorkersSafe));
  }

  private static Site site(
      NavArtifact nav,
      String spawn,
      com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites.Site bomb,
      int[] damage) {
    var canonical =
        nav.approachNode(bomb)
            .orElseThrow(
                () ->
                    new IllegalArgumentException(
                        "health audit bomb has no interaction node: " + bomb.name()));
    var workers =
        nav.bombScreens().require(bomb.name()).workers().stream()
            .map(node -> new Worker(node, damage[node]))
            .toList();
    return new Site(
        spawn,
        bomb.name(),
        canonical,
        damage[canonical],
        workers,
        workers.stream().anyMatch(worker -> worker.minimumDamageWithinBudget() >= 0),
        !workers.isEmpty()
            && workers.stream().allMatch(worker -> worker.minimumDamageWithinBudget() >= 0));
  }

  /** Budget-bounded Dial search: -1 means no route within the complete cumulative damage budget. */
  static int[] minimumDamage(NavGraph graph, int source, int budget) {
    if (source < 0 || source >= graph.nodeCount() || budget < 0 || budget == Integer.MAX_VALUE) {
      throw new IllegalArgumentException("invalid health audit source or budget");
    }
    var damage = new int[graph.nodeCount()];
    Arrays.fill(damage, -1);
    var buckets = new ArrayList<ArrayDeque<Integer>>(budget + 1);
    for (var value = 0; value <= budget; value++) buckets.add(new ArrayDeque<>());
    damage[source] = 0;
    buckets.getFirst().add(source);
    for (var value = 0; value <= budget; value++) {
      var open = buckets.get(value);
      var search = new Search(value, budget, damage, buckets);
      while (!open.isEmpty()) {
        var node = open.removeFirst();
        if (damage[node] == value) expand(graph, node, search);
      }
    }
    return damage;
  }

  private static final class Search {
    final int value;
    final int budget;
    final int[] damage;
    final List<ArrayDeque<Integer>> buckets;

    Search(int value, int budget, int[] damage, List<ArrayDeque<Integer>> buckets) {
      this.value = value;
      this.budget = budget;
      this.damage = damage;
      this.buckets = buckets;
    }
  }

  private static void expand(NavGraph graph, int node, Search search) {
    for (var edge = graph.edgeStart(node); edge < graph.edgeEnd(node); edge++) {
      var edgeDamage = graph.edgeDamage(edge);
      // Compare before addition: sparse wide-fall damage must never overflow into a safe bucket.
      if (edgeDamage > search.budget - search.value) continue;
      var nextDamage = search.value + edgeDamage;
      var next = graph.edgeTarget(edge);
      if (search.damage[next] != -1 && search.damage[next] <= nextDamage) continue;
      search.damage[next] = nextDamage;
      search.buckets.get(nextDamage).add(next);
    }
  }
}
