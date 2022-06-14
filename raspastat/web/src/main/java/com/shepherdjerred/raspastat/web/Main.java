package com.shepherdjerred.raspastat.web;

import com.shepherdjerred.raspastat.web.routes.Router;
import com.shepherdjerred.raspastat.web.util.redis.JedisWrapper;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import spark.Spark;

import static spark.Spark.*;

public class Main {

    public static final Logger logger = LogManager.getLogger(Main.class);

    public static void main(String[] args) {
        port(8080);
        staticFiles.location("/assets");
        new Router().setupRoutes();
    }

    public static void stop() {
        Spark.stop();
        JedisWrapper.getJedisPool().destroy();
    }
}