package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.map.ApproachNodes;
import com.shepherdjerred.thestorm.rwfbots.domain.map.DistanceField;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** Offline defensive formations retained only with their owning loaded navigation artifact. */
public record BombScreens(Map<String, BombScreens.Layout> sites) {
  public static final int MAX_WORKERS = 8;
  public static final int MAX_SCREENS = 256;

  /** Zero workers describes an unplayable diagnostic bake; it cannot pass static certification. */
  public record Layout(List<Integer> workers, List<Integer> screens, int spaciousScreens) {
    public Layout {
      workers = List.copyOf(workers);
      screens = List.copyOf(screens);
      var unique = new HashSet<>(workers);
      if (workers.size() > MAX_WORKERS
          || screens.size() > MAX_SCREENS
          || unique.size() != workers.size()
          || spaciousScreens < 0
          || spaciousScreens > screens.size()) {
        throw new IllegalArgumentException("invalid baked bomb formation size");
      }
      for (var node : screens) {
        if (!unique.add(node)) throw new IllegalArgumentException("duplicate baked formation node");
      }
    }
  }

  public BombScreens {
    sites = Collections.unmodifiableMap(new TreeMap<>(sites));
  }

  public Layout require(String site) {
    var layout = sites.get(site);
    if (layout == null)
      throw new IllegalStateException("bomb has no baked defensive formation: " + site);
    return layout;
  }

  public static BombScreens bake(
      NavGraph graph, VoxelGrid grid, NavSites sites, Map<String, DistanceField> fields) {
    var result = new TreeMap<String, Layout>();
    var shared = ApproachNodes.reachableFromSpawns(graph, sites);
    for (var site : sites.bombs()) {
      var field = requiredField(fields, site.name());
      var workers = new ArrayList<Integer>();
      var eligible = new ArrayList<Integer>();
      for (var node = 0; node < graph.nodeCount(); node++) {
        if (!field.reachable(node)) continue;
        if (shared.get(node) && ApproachNodes.canInteract(graph, grid, node, site.cell())) {
          workers.add(node);
        } else if (graph.feet(node).distance(site.cell().center()) >= 3) eligible.add(node);
      }
      workers.sort(
          Comparator.comparingDouble(
                  (Integer node) -> graph.feet(node).distance(site.cell().center()))
              .thenComparing(java.util.Comparator.naturalOrder()));
      var selectedWorkers = List.copyOf(workers.subList(0, Math.min(MAX_WORKERS, workers.size())));
      eligible.sort(
          Comparator.comparingDouble((Integer node) -> field.at(node))
              .thenComparing(java.util.Comparator.naturalOrder()));
      var screens = new ArrayList<Integer>();
      pack(graph, eligible, screens, 2.5);
      var spacious = screens.size();
      pack(graph, eligible, screens, 0.9);
      result.put(site.name(), new Layout(selectedWorkers, screens, spacious));
    }
    var baked = new BombScreens(result);
    // Worker selection already certified every ray and spawn reachability above.
    baked.validate(graph, sites, fields);
    return baked;
  }

  private static void pack(
      NavGraph graph, List<Integer> eligible, List<Integer> placed, double spacing) {
    for (var node : eligible) {
      if (placed.size() >= MAX_SCREENS) return;
      var point = graph.feet(node);
      if (placed.stream().allMatch(previous -> graph.feet(previous).distance(point) >= spacing)) {
        placed.add(node);
      }
    }
  }

  /** Structural facts remain valid when a live door temporarily occludes an interaction ray. */
  public void validate(NavGraph graph, NavSites sites, Map<String, DistanceField> fields) {
    var expected =
        sites.bombs().stream()
            .map(NavSites.Site::name)
            .collect(java.util.stream.Collectors.toUnmodifiableSet());
    if (!this.sites.keySet().equals(expected)) {
      throw new IllegalArgumentException("baked defensive formations disagree with bomb sites");
    }
    for (var site : sites.bombs()) {
      validateSite(graph, site, requiredField(fields, site.name()));
    }
  }

  /** Only offline baking and persisted static artifacts certify the actual interaction rays. */
  public void validateCertification(
      NavGraph graph, VoxelGrid grid, NavSites sites, Map<String, DistanceField> fields) {
    validate(graph, sites, fields);
    var shared = ApproachNodes.reachableFromSpawns(graph, sites);
    for (var site : sites.bombs()) {
      var workers = require(site.name()).workers();
      if (workers.isEmpty()) {
        throw new IllegalArgumentException(
            "bomb has no reachable certified fuse worker: " + site.name());
      }
      for (var node : workers) {
        if (!shared.get(node) || !ApproachNodes.canInteract(graph, grid, node, site.cell())) {
          throw new IllegalArgumentException("baked fuse worker lacks a certified interaction ray");
        }
      }
    }
  }

  private void validateSite(NavGraph graph, NavSites.Site site, DistanceField field) {
    var layout = require(site.name());
    for (var node : layout.workers()) {
      if (node < 0 || node >= graph.nodeCount() || !field.reachable(node)) {
        throw new IllegalArgumentException(
            "baked fuse worker lacks a certified interaction position");
      }
    }
    for (var node : layout.screens()) {
      if (node < 0
          || node >= graph.nodeCount()
          || !field.reachable(node)
          || graph.feet(node).distance(site.cell().center()) < 3) {
        throw new IllegalArgumentException(
            "baked screen is outside the reachable defensive terrain");
      }
    }
    validateSpacing(graph, layout);
  }

  private static void validateSpacing(NavGraph graph, Layout layout) {
    for (var index = 0; index < layout.screens().size(); index++) {
      var spacing = index < layout.spaciousScreens() ? 2.5 : 0.9;
      var point = graph.feet(layout.screens().get(index));
      for (var previous = 0; previous < index; previous++) {
        if (point.distance(graph.feet(layout.screens().get(previous))) + 1e-6 < spacing) {
          throw new IllegalArgumentException(
              "baked defensive formation violates its spacing contract");
        }
      }
    }
  }

  private static DistanceField requiredField(Map<String, DistanceField> fields, String site) {
    var field = fields.get(site);
    if (field == null)
      throw new IllegalArgumentException("bomb is missing its directed distance field: " + site);
    return field;
  }
}
