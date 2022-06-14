package com.shepherdjerred.easely.api.storage.database;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.flywaydb.core.Flyway;

import javax.sql.DataSource;

public class HikariMysqlDatabase implements Database {
    private DataSource dataSource;

    public HikariMysqlDatabase(HikariConfig hikariConfig) {
        dataSource = new HikariDataSource(hikariConfig);
    }

    public void migrate() {
        Flyway flyway = new Flyway();
        flyway.setDataSource(dataSource);
        flyway.migrate();
    }

    public DataSource getDataSource() {
        return dataSource;
    }
}
