package com.shepherdjerred.thestorm.essentials.adapter.db;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.essentials.domain.home.HistoricalHome;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.DSLContext;

/** One-time restoration into ordinary, player-editable homes. Receipts survive home deletion. */
public final class JooqHomeImport {
  private final StormDatabase database;

  public JooqHomeImport(StormDatabase database) {
    this.database = database;
  }

  /** Native respawns win; only missing bed homes are repaired from the newest archive. */
  public CompletableFuture<Integer> importBeds(List<HistoricalHome> homes, Set<UUID> nativeOwners) {
    var newest = new LinkedHashMap<UUID, HistoricalHome>();
    homes.stream()
        .filter(home -> !home.archive().equals("town"))
        .sorted(Comparator.comparing(HistoricalHome::archive).reversed())
        .forEach(home -> newest.putIfAbsent(home.player(), home));
    var preserved = Set.copyOf(nativeOwners);
    return database.write(
        sql -> {
          var inserted = 0;
          for (var original : newest.values()) {
            var home = new HistoricalHome(original.player(), "bed", original.position());
            if (receipt(sql, home)) continue;
            var p = home.position();
            if (!preserved.contains(home.player())) {
              inserted +=
                  sql.execute(
                      "insert into essentials_homes (player, name, world, x, y, z, yaw, pitch) values (?, 'bed', ?, ?, ?, ?, 0, 0) on conflict (player, name) do nothing",
                      home.player().toString(),
                      p.world(),
                      p.x(),
                      p.y(),
                      p.z());
            }
            sql.execute(
                "insert into essentials_home_import (player, source, world, x, y, z) values (?, 'bed', ?, ?, ?, ?)",
                home.player().toString(),
                p.world(),
                p.x(),
                p.y(),
                p.z());
          }
          return inserted;
        });
  }

  public CompletableFuture<Integer> importHomes(List<HistoricalHome> homes) {
    var ordered =
        homes.stream()
            .sorted(
                Comparator.comparing(
                        (HistoricalHome home) ->
                            home.archive().equals("town") ? "" : home.archive())
                    .reversed())
            .toList();
    return database.write(
        sql -> {
          var imported = 0;
          for (var home : ordered) {
            if (receipt(sql, home)) continue;
            restore(sql, home, primary(ordered, home.player()));
            var p = home.position();
            sql.execute(
                "insert into essentials_home_import (player, source, world, x, y, z) values (?, ?, ?, ?, ?, ?)",
                home.player().toString(),
                home.archive(),
                p.world(),
                p.x(),
                p.y(),
                p.z());
            imported++;
          }
          return imported;
        });
  }

  private static String primary(List<HistoricalHome> homes, UUID player) {
    return homes.stream()
        .filter(home -> home.player().equals(player))
        .map(HistoricalHome::archive)
        .filter(source -> !source.equals("town"))
        .findFirst()
        .orElse("town");
  }

  private static boolean receipt(DSLContext sql, HistoricalHome home) {
    var row =
        sql.fetchOne(
            "select world, x, y, z from essentials_home_import where player = ? and source = ?",
            home.player().toString(),
            home.archive());
    if (row == null) return false;
    var p = home.position();
    if (!p.world().equals(row.get(0, String.class))
        || Double.compare(p.x(), row.get(1, Double.class)) != 0
        || Double.compare(p.y(), row.get(2, Double.class)) != 0
        || Double.compare(p.z(), row.get(3, Double.class)) != 0)
      throw new IllegalStateException(
          "Changed home import evidence: " + home.player() + ":" + home.archive());
    return true;
  }

  private static void restore(DSLContext sql, HistoricalHome home, String primary) {
    var player = home.player().toString();
    var p = home.position();
    if (sql.fetchExists(
        sql.selectFrom("essentials_homes")
            .where(
                "player = ? and world = ? and x = ? and y = ? and z = ?",
                player,
                p.world(),
                p.x(),
                p.y(),
                p.z()))) return;
    var mapName =
        switch (home.archive()) {
          case "2015" -> "map1";
          case "2016" -> "map2";
          case "town" -> "town";
          default -> throw new IllegalArgumentException("Unknown home source: " + home.archive());
        };
    var name = home.archive().equals(primary) && !home.archive().equals("town") ? "home" : mapName;
    if (exists(sql, player, name)) name = mapName;
    var base = name;
    for (int suffix = 2; exists(sql, player, name); suffix++) name = base + "-" + suffix;
    sql.execute(
        "insert into essentials_homes (player, name, world, x, y, z, yaw, pitch) values (?, ?, ?, ?, ?, ?, ?, ?)",
        player,
        name,
        p.world(),
        p.x(),
        p.y(),
        p.z(),
        (double) p.yaw(),
        (double) p.pitch());
  }

  private static boolean exists(DSLContext sql, String player, String name) {
    return sql.fetchExists(
        sql.selectFrom("essentials_homes").where("player = ? and name = ?", player, name));
  }
}
