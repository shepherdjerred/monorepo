package com.shepherdjerred.thestorm.tools.rwfmap;

import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeMap;

/**
 * The human-readable companion of a baked artifact: counts and the palette classification, as
 * deterministic JSON, so a review diff shows what a map or block-table change did to the analysis.
 */
final class Summary {

  private Summary() {}

  static String of(
      NavArtifact artifact,
      SchematicClassification classification,
      List<String> problems,
      byte[] bytes) {
    var json = new Json();
    json.open("{");
    json.field("mapId", artifact.mapId());
    json.field("formatVersion", artifact.formatVersion());
    json.field("generatorVersion", artifact.generatorVersion());
    json.field("blocksSha256", artifact.blocksSha256());
    json.field("classificationSha256", MapBaker.sha256(classification));
    bounds(json, artifact);
    palette(json, classification);
    cells(json, artifact);
    edges(json, artifact);
    json.field("regions", artifact.regions().count());
    json.field("coverPoints", artifact.cover().points().size());
    json.field("chokepoints", artifact.chokepoints().points().size());
    routes(json, artifact);
    json.field("distanceFields", artifact.distanceFields().size());
    json.rawField("problems", strings(problems));
    json.field("bytes", bytes.length);
    json.close("}");
    return json.toString();
  }

  private static void bounds(Json json, NavArtifact artifact) {
    var bounds = artifact.grid().bounds();
    json.key("bounds");
    json.open("{");
    json.rawField(
        "origin",
        "{ \"x\": "
            + bounds.origin().x()
            + ", \"y\": "
            + bounds.origin().y()
            + ", \"z\": "
            + bounds.origin().z()
            + " }");
    json.field("sizeX", bounds.sizeX());
    json.field("sizeY", bounds.sizeY());
    json.field("sizeZ", bounds.sizeZ());
    json.close("}");
  }

  private static void palette(Json json, SchematicClassification classification) {
    var schematic = classification.schematic();
    var counts = new int[schematic.palette().size()];
    for (var i = 0; i < schematic.blockCount(); i++) {
      counts[schematic.paletteIndexAt(i)]++;
    }
    json.key("palette");
    json.open("[");
    for (var i = 0; i < counts.length; i++) {
      var classified = classification.palette().get(i);
      json.open("{");
      json.field("state", schematic.palette().get(i));
      json.field("shape", classified.shape().name());
      json.field("blocksSight", classified.blocksSight());
      json.field("blocks", counts[i]);
      json.close("}");
    }
    json.close("]");
  }

  private static void cells(Json json, NavArtifact artifact) {
    json.key("cells");
    json.open("{");
    json.field("total", artifact.grid().bounds().volume());
    json.field("walkable", artifact.graph().nodeCount());
    json.close("}");
  }

  private static void edges(Json json, NavArtifact artifact) {
    var graph = artifact.graph();
    var byHop = new TreeMap<String, Integer>();
    for (var hop : Hop.values()) {
      byHop.put(hop.name(), 0);
    }
    for (var edge = 0; edge < graph.edgeCount(); edge++) {
      byHop.merge(graph.edgeHop(edge).name(), 1, Integer::sum);
    }
    json.key("edges");
    json.open("{");
    json.field("total", graph.edgeCount());
    byHop.forEach(json::field);
    json.close("}");
  }

  private static void routes(Json json, NavArtifact artifact) {
    json.key("routes");
    json.open("{");
    json.field("count", artifact.routes().routes().size());
    json.key("spawnToBomb");
    json.open("[");
    for (var spawn : artifact.sites().spawns()) {
      for (var bomb : artifact.sites().bombs()) {
        for (var route : artifact.routes().between(spawn.name(), bomb.name())) {
          json.open("{");
          json.field("from", route.from());
          json.field("to", route.to());
          json.field("length", route.length());
          json.field("nodes", route.nodes().size());
          json.close("}");
        }
      }
    }
    json.close("]");
    json.close("}");
  }

  private static String strings(List<String> values) {
    if (values.isEmpty()) {
      return "[]";
    }
    var quoted = new ArrayList<String>();
    for (var value : values) {
      quoted.add(Json.quote(value));
    }
    return "[" + String.join(", ", quoted) + "]";
  }

  /** A minimal pretty printer: two-space indentation, keys in call order, a trailing newline. */
  private static final class Json {

    private final StringBuilder out = new StringBuilder();
    private final List<Boolean> firstInScope = new ArrayList<>();
    private int depth;
    private boolean afterKey;

    void open(String bracket) {
      separate();
      out.append(bracket);
      firstInScope.add(true);
      depth++;
    }

    void close(String bracket) {
      depth--;
      var empty = firstInScope.removeLast();
      if (!empty) {
        out.append('\n').append("  ".repeat(depth));
      }
      out.append(bracket);
      if (depth == 0) {
        out.append('\n');
      }
    }

    void key(String name) {
      separate();
      out.append(quote(name)).append(": ");
      afterKey = true;
    }

    void field(String name, String value) {
      rawField(name, quote(value));
    }

    void field(String name, int value) {
      rawField(name, Integer.toString(value));
    }

    void field(String name, double value) {
      rawField(name, Double.toString(value));
    }

    void field(String name, boolean value) {
      rawField(name, Boolean.toString(value));
    }

    void rawField(String name, String json) {
      key(name);
      out.append(json);
      afterKey = false;
    }

    private void separate() {
      if (afterKey) {
        afterKey = false;
        return;
      }
      if (firstInScope.isEmpty()) {
        return;
      }
      if (firstInScope.getLast()) {
        firstInScope.set(firstInScope.size() - 1, false);
      } else {
        out.append(',');
      }
      out.append('\n').append("  ".repeat(depth));
    }

    static String quote(String value) {
      var quoted = new StringBuilder("\"");
      for (var i = 0; i < value.length(); i++) {
        var c = value.charAt(i);
        switch (c) {
          case '"' -> quoted.append("\\\"");
          case '\\' -> quoted.append("\\\\");
          case '\n' -> quoted.append("\\n");
          default -> {
            if (c < 0x20) {
              quoted.append(String.format("\\u%04x", (int) c));
            } else {
              quoted.append(c);
            }
          }
        }
      }
      return quoted.append('"').toString();
    }

    @Override
    public String toString() {
      return out.toString();
    }
  }
}
