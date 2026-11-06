package com.shepherdjerred.thestorm.essentials.adapter.files;

import com.shepherdjerred.thestorm.essentials.domain.home.HistoricalHome;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/** Archived bed locations and surveyed town destinations for returning players. */
public final class HistoricalHomeCatalog {
  private HistoricalHomeCatalog() {}

  public static List<HistoricalHome> load() {
    var stream =
        Objects.requireNonNull(
            HistoricalHomeCatalog.class.getResourceAsStream("/historical-homes.csv"),
            "historical homes catalog is missing");
    try (var reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
      return read(reader);
    } catch (IOException failure) {
      throw new UncheckedIOException("cannot read historical homes catalog", failure);
    }
  }

  static List<HistoricalHome> read(BufferedReader reader) throws IOException {
    var result = new ArrayList<HistoricalHome>();
    var seen = new HashSet<String>();
    String line;
    while ((line = reader.readLine()) != null) {
      if (line.startsWith("#")) continue;
      var fields = line.split(",", -1);
      if (fields.length != 6) throw new IllegalArgumentException("invalid historical home row");
      var player = UUID.fromString(fields[0]);
      var archive = fields[1];
      var world = fields[2];
      if (!(archive.equals("2015") && world.equals("world"))
          && !(archive.equals("2016") && world.equals("map2"))
          && !(archive.equals("town") && (world.equals("world") || world.equals("map2")))) {
        throw new IllegalArgumentException("invalid historical archive world mapping");
      }
      if (!seen.add(player + ":" + archive))
        throw new IllegalArgumentException("duplicate historical home");
      var x = Integer.parseInt(fields[3]);
      var y = Integer.parseInt(fields[4]);
      var z = Integer.parseInt(fields[5]);
      result.add(
          new HistoricalHome(player, archive, new Position(world, x + 0.5, y, z + 0.5, 0, 0)));
    }
    return List.copyOf(result);
  }
}
