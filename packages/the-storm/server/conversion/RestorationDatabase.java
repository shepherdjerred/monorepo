import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageConfig;
import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.jar.JarFile;

/** Offline database creation uses the exact candidate's Flyway and historical town identities. */
public final class RestorationDatabase {
  private RestorationDatabase() {}

  public record Policy(int schemaVersion, String archiveSha256, List<String> retainTables,
      List<String> resetTables, List<String> migrationModules) {
    public Policy {
      retainTables = List.copyOf(retainTables);
      resetTables = List.copyOf(resetTables);
      migrationModules = List.copyOf(migrationModules);
      var tables = new HashSet<String>();
      for (var table : java.util.stream.Stream.concat(retainTables.stream(), resetTables.stream()).toList()) {
        if (!table.matches("[a-z_]+") || !tables.add(table)) throw new IllegalArgumentException("Invalid table policy");
      }
      if (schemaVersion != 1 || !archiveSha256.matches("[a-f0-9]{64}") || retainTables.isEmpty()
          || resetTables.isEmpty() || migrationModules.isEmpty()
          || new HashSet<>(migrationModules).size() != migrationModules.size()
          || migrationModules.stream().anyMatch(module -> !module.matches("[a-z_]+"))) {
        throw new IllegalArgumentException("Invalid restoration policy");
      }
    }
  }

  public static void main(String[] args) throws Exception {
    if (args.length < 4) throw new IllegalArgumentException("Expected schema|towns, candidate jar, database, policy|heritage, optional import instant");
    var jar = Path.of(args[1]).toRealPath();
    var database = Path.of(args[2]).toAbsolutePath().normalize();
    var config = Path.of(args[3]).toRealPath();
    switch (args[0]) {
      case "schema" -> {
        if (args.length != 4) throw new IllegalArgumentException("Schema creation takes exactly four arguments");
        schema(jar, database, parse(config, Policy.class));
      }
      case "towns" -> {
        if (args.length != 5) throw new IllegalArgumentException("Town import requires its recorded import instant");
        towns(database, parse(config, HeritageConfig.class), Instant.parse(args[4]));
      }
      default -> throw new IllegalArgumentException("Unknown database operation");
    }
  }

  private static <T> T parse(Path file, Class<T> type) throws IOException {
    return switch (StrictYaml.parse(file.toString(), Files.readString(file), type)) {
      case Result.Ok<T, List<com.shepherdjerred.thestorm.core.config.Problem>>(var value) -> value;
      case Result.Err<T, List<com.shepherdjerred.thestorm.core.config.Problem>>(var errors) ->
          throw new IllegalArgumentException("Invalid restoration configuration: " + errors);
    };
  }

  private static void schema(Path jar, Path output, Policy policy) throws IOException {
    if (Files.exists(output) || Files.isSymbolicLink(output)) throw new IllegalArgumentException("Database output already exists");
    var modules = new HashSet<String>();
    try (var archive = new JarFile(jar.toFile())) {
      archive.stream().filter(entry -> entry.getName().matches("db/migration/[a-z_]+/V.+\\.sql"))
          .forEach(entry -> modules.add(entry.getName().split("/")[2]));
    }
    if (!modules.equals(new HashSet<>(policy.migrationModules()))) {
      throw new IllegalArgumentException("Candidate migrations differ from the reviewed restoration policy");
    }
    try (var database = StormDatabase.open(output)) {
      for (var module : policy.migrationModules()) database.migrate(module, RestorationDatabase.class.getClassLoader());
    }
  }

  private static void towns(Path database, HeritageConfig heritage, Instant importedAt) throws Exception {
    if (!Files.isRegularFile(database) || Files.isSymbolicLink(database)) {
      throw new IllegalArgumentException("Expected an existing fresh migrated database");
    }
    var sites = heritage.sites().stream().filter(site -> site.kind() == HeritageSite.Kind.PLAYER).toList();
    if (sites.size() != 7) throw new IllegalArgumentException("Expected the seven proven historical mayors");
    // Use the domain's own validation and UUID function; never duplicate its identity algorithm.
    var imported = sites.stream().map(site -> Town.found(site.activeTownId().orElseThrow(),
        site.activeTownName(), importedAt, site.editors().getFirst().player())).toList();
    try (var connection = DriverManager.getConnection("jdbc:sqlite:" + database)) {
      connection.createStatement().execute("PRAGMA foreign_keys=ON");
      for (var table : List.of("towns_town", "towns_member", "towns_claim")) {
        try (var rows = connection.createStatement().executeQuery("SELECT COUNT(*) FROM " + table)) {
          if (!rows.next() || rows.getLong(1) != 0) throw new IllegalStateException("Historical import requires empty " + table);
        }
      }
      connection.setAutoCommit(false);
      try (var town = connection.prepareStatement("INSERT INTO towns_town(id,name,created_at,governor_level) VALUES(?,?,?,0)");
          var member = connection.prepareStatement("INSERT INTO towns_member(player_id,town_id,role) VALUES(?,?,'OWNER')")) {
        for (var value : imported) {
          town.setString(1, value.id().toString());
          town.setString(2, value.name());
          town.setLong(3, value.createdAt().toEpochMilli());
          town.executeUpdate();
          member.setString(1, value.owner().toString());
          member.setString(2, value.id().toString());
          member.executeUpdate();
        }
        try (var invalid = connection.createStatement().executeQuery("PRAGMA foreign_key_check")) {
          if (invalid.next()) throw new IllegalStateException("Historical import violates foreign keys");
        }
        connection.commit();
      } catch (Exception failure) {
        connection.rollback();
        throw failure;
      }
      connection.setAutoCommit(true);
      connection.createStatement().execute("PRAGMA wal_checkpoint(TRUNCATE)");
    }
  }
}
