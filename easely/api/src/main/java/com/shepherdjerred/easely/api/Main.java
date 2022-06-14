package com.shepherdjerred.easely.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.shepherdjerred.easely.api.config.EaselyConfig;
import com.shepherdjerred.easely.api.config.EnvVarEaselyConfig;
import com.shepherdjerred.easely.api.easel.cache.RedissonCache;
import com.shepherdjerred.easely.api.easel.cache.ScraperLoader;
import com.shepherdjerred.easely.api.easel.datasource.CacheDataSource;
import com.shepherdjerred.easely.api.easel.datasource.EaselDataSource;
import com.shepherdjerred.easely.api.easel.scraper.CachedEaselScraper;
import com.shepherdjerred.easely.api.http.router.AssignmentRouter;
import com.shepherdjerred.easely.api.http.router.CourseRouter;
import com.shepherdjerred.easely.api.http.router.UserRouter;
import com.shepherdjerred.easely.api.storage.MysqlStore;
import com.shepherdjerred.easely.api.storage.database.HikariMysqlDatabase;
import lombok.extern.log4j.Log4j2;
import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.codec.JsonJacksonCodec;
import org.redisson.config.Config;

import static spark.Spark.*;

@Log4j2
public class Main {

    private static EaselyConfig easelyConfig;
    private static com.shepherdjerred.easely.api.storage.Store store;
    private static EaselDataSource easelDataSource;
    private static RedissonClient redisson;

    public static void main(String args[]) {
        easelyConfig = new EnvVarEaselyConfig();
        setupMysqlStore();
        setupRedission();
        easelDataSource = new CacheDataSource(new RedissonCache(redisson, new ScraperLoader(new CachedEaselScraper(redisson))));
        setupRoutes();
    }

    private static void setupRedission() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());

        Config config = easelyConfig.getRedissonConfig();
        config.useSingleServer()
                .setConnectionMinimumIdleSize(5)
                .setConnectionPoolSize(20);
        config.setCodec(new JsonJacksonCodec(mapper));
        redisson = Redisson.create(config);
    }

    private static void setupMysqlStore() {
        HikariMysqlDatabase hikariMysqlDatabase = new HikariMysqlDatabase(easelyConfig.getHikariConfig());
        hikariMysqlDatabase.migrate();
        store = new MysqlStore(hikariMysqlDatabase);
    }

    private static void setupRoutes() {
        port(easelyConfig.getServerPort());

        enableCors();

        new AssignmentRouter(store, easelDataSource, easelyConfig).setupRoutes();
        new CourseRouter(store, easelDataSource, easelyConfig).setupRoutes();
        new UserRouter(store, easelyConfig).setupRoutes();
    }

    private static void enableCors() {
        options("/*", (request, response) -> {
            log.debug("Accepting OPTIONS request");

            String accessControlRequestHeaders = request.headers("Access-Control-Request-Headers");
            if (accessControlRequestHeaders != null) {
                response.header("Access-Control-Allow-Headers", accessControlRequestHeaders);
            }

            String accessControlRequestMethod = request.headers("Access-Control-Request-Method");
            if (accessControlRequestMethod != null) {
                response.header("Access-Control-Allow-Methods", accessControlRequestMethod);
            }

            return "OK";
        });

        before((request, response) -> response.header("Access-Control-Allow-Origin", "*"));
    }

}
