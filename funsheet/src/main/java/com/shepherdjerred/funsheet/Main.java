package com.shepherdjerred.funsheet;

import com.shepherdjerred.funsheet.controller.*;
import com.shepherdjerred.funsheet.objects.*;
import com.shepherdjerred.funsheet.storage.InMemoryStore;
import com.shepherdjerred.funsheet.storage.Store;
import com.shepherdjerred.funsheet.storage.mysql.Database;
import com.shepherdjerred.funsheet.storage.mysql.MysqlStore;
import com.zaxxer.hikari.HikariConfig;
import lombok.extern.log4j.Log4j2;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Collections;
import java.util.UUID;

import static spark.Spark.port;
import static spark.Spark.staticFileLocation;

@Log4j2
public class Main {

    private static Store store;

    public static void main(String args[]) {
        setupMysqlStorage();
        setupRoutes();
    }

    private static void createMockData() {
        Tag entertainment = new Tag("Entertainment", UUID.randomUUID());
        Tag food = new Tag("Food", UUID.randomUUID());
        Tag outdoors = new Tag("Outdoors", UUID.randomUUID());

        Location littleRock = new Location("Little Rock", UUID.randomUUID(), "ChIJm1YfoTSh0ocRF1vzDRD1BTQ");
        Location searcy = new Location("Searcy", UUID.randomUUID(), "ChIJRdqBTnCp04cR9YqY9ZaPmdo");
        Location baldKnob = new Location("Bald Knob", UUID.randomUUID(), "ChIJR47VhpCY04cRdHg7FXFimY8");

        Type movieTheater = new Type("Movie Theater", UUID.randomUUID(), Collections.singletonList(entertainment));
        Type restaurant = new Type("Restaurant", UUID.randomUUID(), Collections.singletonList(food));
        Type hiking = new Type("Hiking", UUID.randomUUID(), Collections.singletonList(outdoors));

        Activity littleRockRiverTrail = new Activity(
                "Arkansas River Trail",
                UUID.randomUUID(),
                hiking,
                3,
                littleRock,
                1,
                "The Arkansas River Trail is a rail trail that runs 17 miles in along both sides of the Arkansas River in Central Arkansas.");
        Activity searcyMovieTheatre = new Activity(
                "Searcy Cinema 8",
                UUID.randomUUID(),
                movieTheater,
                2,
                searcy,
                2,
                "Searcy Cinema 8 - movie theatre serving Searcy, Arkansas and the surrounding area. Great family entertainment at your local movie theater.");
        Activity bulldogCafe = new Activity(
                "Bulldog Restaurant",
                UUID.randomUUID(),
                restaurant,
                3,
                baldKnob,
                1,
                "Great strawberry shortcake!");

        store.addTag(entertainment);
        store.addTag(food);
        store.addTag(outdoors);

        store.addLocation(littleRock);
        store.addLocation(searcy);
        store.addLocation(baldKnob);

        store.addType(movieTheater);
        store.addType(restaurant);
        store.addType(hiking);

        store.addActivity(littleRockRiverTrail);
        store.addActivity(searcyMovieTheatre);
        store.addActivity(bulldogCafe);
    }

    private static void setupInMemoryStorage() {
        store = new InMemoryStore();
    }

    private static void setupMysqlStorage() {
        HikariConfig hikariConfig = getHikariConfig();

        Database database = new Database(hikariConfig);
        database.migrate();

        store = new MysqlStore(database);
    }

    private static HikariConfig getHikariConfig() {
        ProcessBuilder processBuilder = new ProcessBuilder();
        if (processBuilder.environment().get("CLEARDB_DATABASE_URL") != null) {
            HikariConfig hikariConfig = new HikariConfig();
            try {
                URI jdbUri = new URI(processBuilder.environment().get("CLEARDB_DATABASE_URL"));
                String jdbcUrl = "jdbc:mysql://" + jdbUri.getHost() + ":" + String.valueOf(jdbUri.getPort()) + jdbUri.getPath();

                hikariConfig.setJdbcUrl(jdbcUrl);
                hikariConfig.setUsername(jdbUri.getUserInfo().split(":")[0]);
                hikariConfig.setPassword(jdbUri.getUserInfo().split(":")[1]);
                hikariConfig.setMaximumPoolSize(4);
            } catch (URISyntaxException e) {
                e.printStackTrace();
            }

            return hikariConfig;
        } else {
            return new HikariConfig("hikari.properties");
        }
    }

    private static void setupRoutes() {

        int port = getPort();
        port(port);
        staticFileLocation("/funsheet-vue/dist");

        new ActivityController(store).setupRoutes();
        new TypeController(store).setupRoutes();
        new TagController(store).setupRoutes();
        new LocationController(store).setupRoutes();

        new UserController(store).setupRoutes();
    }

    private static int getPort() {
        ProcessBuilder processBuilder = new ProcessBuilder();
        if (processBuilder.environment().get("PORT") != null) {
            return Integer.parseInt(processBuilder.environment().get("PORT"));
        }
        return 8080;
    }

}
