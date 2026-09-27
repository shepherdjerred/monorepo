package com.shepherdjerred.thestorm.core.db;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.nio.file.Path;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Function;
import org.flywaydb.core.Flyway;
import org.jooq.DSLContext;
import org.jooq.SQLDialect;
import org.jooq.impl.DSL;

/**
 * The plugin's single SQLite database.
 *
 * <p>Each module migrates its own schema with Flyway (its scripts live in {@code
 * db/migration/<module>} and it has its own history table). All writes run on one writer thread, in
 * a transaction, so SQLite never sees concurrent writers. Reads run on virtual threads, each after
 * the writes queued before it. Nothing here may be called from the main thread and waited on;
 * callers complete the returned futures back onto the main thread through the scheduler.
 */
public final class StormDatabase implements AutoCloseable {

  private final HikariDataSource dataSource;
  private final DSLContext dsl;
  private final ExecutorService writer;
  private final ExecutorService readers;

  private StormDatabase(HikariDataSource dataSource) {
    this.dataSource = dataSource;
    this.dsl = DSL.using(dataSource, SQLDialect.SQLITE);
    this.writer =
        Executors.newSingleThreadExecutor(Thread.ofPlatform().name("storm-db-writer").factory());
    this.readers =
        Executors.newThreadPerTaskExecutor(Thread.ofVirtual().name("storm-db-read-", 0).factory());
  }

  /** Opens (creating if needed) the database file at {@code file}. */
  public static StormDatabase open(Path file) {
    var config = new HikariConfig();
    config.setPoolName("the-storm");
    config.setDriverClassName("org.sqlite.JDBC");
    config.setJdbcUrl("jdbc:sqlite:" + file.toAbsolutePath());
    config.setMaximumPoolSize(4);
    config.addDataSourceProperty("journal_mode", "WAL");
    config.addDataSourceProperty("synchronous", "NORMAL");
    config.addDataSourceProperty("foreign_keys", "true");
    config.addDataSourceProperty("busy_timeout", "5000");
    return new StormDatabase(new HikariDataSource(config));
  }

  /** Applies {@code module}'s migrations from {@code db/migration/<module>} on {@code loader}. */
  public void migrate(String module, ClassLoader loader) {
    Flyway.configure(loader)
        .dataSource(dataSource)
        .locations("classpath:db/migration/" + module)
        .table("flyway_" + module + "_history")
        // Modules share one database, so a module's first migration always finds other
        // modules' tables. Baselining an empty history at version 0 lets its V1 still run.
        .baselineOnMigrate(true)
        .baselineVersion("0")
        .failOnMissingLocations(true)
        .load()
        .migrate();
  }

  /** Runs {@code work} in a transaction on the writer thread. */
  public <T> CompletableFuture<T> write(Function<DSLContext, T> work) {
    return CompletableFuture.supplyAsync(
        () -> dsl.transactionResult(configuration -> work.apply(configuration.dsl())), writer);
  }

  /**
   * Runs {@code work} on a virtual thread once every write submitted before this call has finished,
   * so a read always sees the caller's earlier writes (a player's state loaded on rejoin includes
   * the save queued when they quit).
   */
  public <T> CompletableFuture<T> read(Function<DSLContext, T> work) {
    return CompletableFuture.runAsync(() -> {}, writer)
        .thenApplyAsync(ignored -> work.apply(dsl), readers);
  }

  @Override
  public void close() {
    writer.close();
    readers.close();
    dataSource.close();
  }
}
