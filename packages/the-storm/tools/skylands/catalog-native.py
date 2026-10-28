"""Export relative jigsaw metadata from a locally licensed, pinned Paper jar. No game assets are copied."""

# /// script
# requires-python = ">=3.12"
# dependencies = ["nbtlib>=2.0.4,<3"]
# ///

import argparse
import gzip
import io
import zipfile
from pathlib import Path

import nbtlib

parser = argparse.ArgumentParser()
parser.add_argument("--paper-jar", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
rows = []
with zipfile.ZipFile(args.paper_jar) as jar:
    for name in sorted(jar.namelist()):
        if not name.endswith(".nbt"):
            continue
        key = name.removeprefix("data/minecraft/structure/").removesuffix(".nbt")
        parts = key.split("/")
        allowed = key.startswith("ancient_city/") or (
            len(parts) == 4
            and parts[0] == "village"
            and parts[1] in {"plains", "desert", "savanna", "snowy", "taiga"}
            and parts[2] in {"houses", "town_centers"}
        )
        if not allowed:
            continue
        native = nbtlib.File.parse(io.BytesIO(gzip.decompress(jar.read(name))))
        rows.append("@" + key)
        palette = native["palette"]
        for block in native["blocks"]:
            state = palette[int(block["state"])]
            if str(state["id"]) != "minecraft:jigsaw":
                continue
            tile = block["nbt"]
            facing = str(state["properties"]["orientation"]).split("_")[0]
            values = [
                *(str(int(v)) for v in block["pos"]),
                str(tile["final_state"]),
                facing,
                str(tile["name"]),
                str(tile["target"]),
                str(tile["pool"]),
            ]
            rows.append("|".join(values))

source = """package com.shepherdjerred.thestorm.skylands.adapter.paper;

import com.shepherdjerred.thestorm.skylands.domain.SkyJoin;
import com.shepherdjerred.thestorm.skylands.domain.SkyPosition;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Generated relative metadata for native Paper26.3 pieces; regenerate with catalog-native.py. */
final class NativeSkyConnectors {
  record Connector(SkyPosition position, String block, SkyJoin join) {}
  private NativeSkyConnectors() {}

  static final Map<String, List<Connector>> LINKS = read();

  private static Map<String, List<Connector>> read() {
    var result = new LinkedHashMap<String, List<Connector>>();
    List<Connector> current = new ArrayList<>();
    for (var line : String.join("", data()).strip().split("\\n", -1)) {
      if (line.startsWith("@")) {
        current = new ArrayList<>();
        result.put(line.substring(1), current);
      } else current.add(connector(line));
    }
    return result.entrySet().stream().collect(java.util.stream.Collectors.toUnmodifiableMap(
        Map.Entry::getKey, e -> List.copyOf(e.getValue())));
  }

  private static Connector connector(String row) {
    var fields = row.split("\\\\|", -1);
    if (fields.length != 8) throw new IllegalArgumentException("Invalid native socket row");
    var p = new SkyPosition(Integer.parseInt(fields[0]), Integer.parseInt(fields[1]), Integer.parseInt(fields[2]));
    var direction = switch (fields[4]) {
      case "north" -> new SkyPosition(0, 0, -1);
      case "south" -> new SkyPosition(0, 0, 1);
      case "west" -> new SkyPosition(-1, 0, 0);
      case "east" -> new SkyPosition(1, 0, 0);
      case "up" -> new SkyPosition(0, 1, 0);
      case "down" -> new SkyPosition(0, -1, 0);
      default -> throw new IllegalArgumentException("Invalid native socket direction");
    };
    return new Connector(p, fields[3], new SkyJoin(p, direction, fields[5], fields[6], fields[7]));
  }

  private static List<String> data() { return List.of(
"""
chunks = [rows[i : i + 100] for i in range(0, len(rows), 100)]
source += ",\n".join('      """\n' + "\n".join("      " + row for row in chunk) + '\n      """' for chunk in chunks)
source += "); }\n}\n"
args.output.write_text(source, encoding="utf-8")
print(f"Exported {sum(row.startswith('@') for row in rows)} native templates and relative sockets")
