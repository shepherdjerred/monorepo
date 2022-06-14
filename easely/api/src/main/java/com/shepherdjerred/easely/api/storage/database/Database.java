package com.shepherdjerred.easely.api.storage.database;

import javax.sql.DataSource;

public interface Database {
    void migrate();
    DataSource getDataSource();
}
