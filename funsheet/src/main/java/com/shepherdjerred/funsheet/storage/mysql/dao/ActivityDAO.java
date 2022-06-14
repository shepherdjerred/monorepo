package com.shepherdjerred.funsheet.storage.mysql.dao;

import com.shepherdjerred.funsheet.objects.Activity;
import com.shepherdjerred.funsheet.objects.Location;
import com.shepherdjerred.funsheet.objects.Type;
import com.shepherdjerred.funsheet.storage.mysql.MysqlStore;
import lombok.extern.log4j.Log4j2;
import org.codejargon.fluentjdbc.api.FluentJdbc;
import org.codejargon.fluentjdbc.api.FluentJdbcBuilder;
import org.codejargon.fluentjdbc.api.query.Mapper;
import org.codejargon.fluentjdbc.api.query.Query;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

@Log4j2
public class ActivityDAO implements DAO<Activity> {

    private final FluentJdbc fluentJdbc;
    private final Mapper<Activity> activityMapper;

    public ActivityDAO(MysqlStore store) {
        fluentJdbc = new FluentJdbcBuilder().connectionProvider(store.getDatabase().getDataSource()).build();

        activityMapper = rs -> {
            Type type = null;
            Location location = null;

            String typeUuidString = rs.getString("type_uuid");
            String locationUuidString = rs.getString("location_uuid");

            if (typeUuidString != null) {
                type = store.getType(UUID.fromString(typeUuidString)).get();
            }
            if (locationUuidString != null) {
                location = store.getLocation(UUID.fromString(locationUuidString)).get();
            }

            return new Activity(rs.getString("name"),
                    UUID.fromString(rs.getString("activity_uuid")),
                    type,
                    rs.getInt("rating"),
                    location,
                    rs.getInt("cost"),
                    rs.getString("description")
            );
        };
    }

    public Optional<Activity> select(String name) {
        Query query = fluentJdbc.query();
        return query.select("SELECT * FROM activity WHERE name = ?")
                .params(name)
                .firstResult(activityMapper);
    }

    @Override
    public Optional<Activity> select(UUID uuid) {
        Query query = fluentJdbc.query();
        return query.select("SELECT * FROM activity WHERE activity_uuid = ?")
                .params(String.valueOf(uuid))
                .firstResult(activityMapper);
    }

    @Override
    public Collection<Activity> select() {
        Query query = fluentJdbc.query();
        return query.select("SELECT * FROM activity")
                .listResult(activityMapper);
    }

    @Override
    public void insert(Activity activity) {

        String type = activity.getType() != null ? String.valueOf(activity.getType().getUuid()) : null;
        String location = activity.getLocation() != null ? String.valueOf(activity.getLocation().getUuid()) : null;

        Query query = fluentJdbc.query();
        query.update("INSERT INTO activity VALUES (?, ?, ?, ?, ?, ?, ?)")
                .params(String.valueOf(activity.getUuid()),
                        activity.getName(),
                        type,
                        activity.getRating(),
                        location,
                        activity.getCost(),
                        activity.getDescription())
                .run();
    }

    @Override
    public void drop(Activity activity) {
        Query query = fluentJdbc.query();
        query.update("DELETE FROM activity WHERE activity_uuid = ?")
                .params(String.valueOf(activity.getUuid()))
                .run();
    }

    @Override
    public void update(Activity activity) {
        Query query = fluentJdbc.query();
        query.update("UPDATE activity SET name = ?, type_uuid = ?, rating = ?, location_uuid = ?, cost = ?, description = ? WHERE activity_uuid = ?")
                .params(activity.getName(),
                        String.valueOf(activity.getType().getUuid()),
                        activity.getRating(),
                        String.valueOf(activity.getLocation().getUuid()),
                        activity.getCost(),
                        activity.getDescription(),
                        String.valueOf(activity.getUuid()))
                .run();
    }

}
