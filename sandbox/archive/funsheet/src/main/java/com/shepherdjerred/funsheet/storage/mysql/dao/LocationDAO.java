package com.shepherdjerred.funsheet.storage.mysql.dao;

import com.shepherdjerred.funsheet.objects.Location;
import com.shepherdjerred.funsheet.storage.mysql.MysqlStore;
import org.codejargon.fluentjdbc.api.FluentJdbc;
import org.codejargon.fluentjdbc.api.FluentJdbcBuilder;
import org.codejargon.fluentjdbc.api.query.Mapper;
import org.codejargon.fluentjdbc.api.query.Query;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

public class LocationDAO implements DAO<Location> {

    private final FluentJdbc fluentJdbc;
    private static Mapper<Location> locationMapper;

    public LocationDAO(MysqlStore store) {
        fluentJdbc = new FluentJdbcBuilder().connectionProvider(store.getDatabase().getDataSource()).build();

        locationMapper = rs -> new Location(
                rs.getString("name"),
                UUID.fromString(rs.getString("location_uuid")),
                rs.getString("placeId")
        );
    }

    public Optional<Location> select(String name) {
        Query query = fluentJdbc.query();
        return query.select("SELECT * FROM location WHERE name = ?")
                .params(name)
                .firstResult(locationMapper);
    }

    @Override
    public Optional<Location> select(UUID uuid) {
        Query query = fluentJdbc.query();
        return query.select("SELECT * FROM location WHERE location_uuid = ?")
                .params(String.valueOf(uuid))
                .firstResult(locationMapper);
    }

    @Override
    public Collection<Location> select() {
        Query query = fluentJdbc.query();
        return query.select("SELECT * FROM location")
                .listResult(locationMapper);
    }

    @Override
    public void insert(Location location) {
        Query query = fluentJdbc.query();
        query.update("INSERT INTO location VALUES (?, ?, ?)")
                .params(String.valueOf(location.getUuid()),
                        location.getName(),
                        location.getPlaceId())
                .run();
    }

    @Override
    public void drop(Location location) {
        Query query = fluentJdbc.query();
        query.update("DELETE FROM location WHERE location_uuid = ?")
                .params(String.valueOf(location.getUuid()))
                .run();
    }

    @Override
    public void update(Location location) {
        Query query = fluentJdbc.query();
        query.update("UPDATE location SET name = ?, placeId = ? WHERE location_uuid = ?")
                .params(location.getName(),
                        location.getPlaceId(),
                        String.valueOf(location.getUuid()))
                .run();
    }
}
