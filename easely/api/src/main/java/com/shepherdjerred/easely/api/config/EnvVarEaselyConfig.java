package com.shepherdjerred.easely.api.config;

import com.zaxxer.hikari.HikariConfig;
import lombok.extern.log4j.Log4j2;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;

@Log4j2
public class EnvVarEaselyConfig implements EaselyConfig {

    private ProcessBuilder processBuilder;

    public EnvVarEaselyConfig() {
        processBuilder = new ProcessBuilder();
    }

    @Override
    public int getServerPort() {
        String portVar = processBuilder.environment().get("PORT");
        if (portVar != null) {
            return Integer.parseInt(portVar);
        } else {
            log.warn("No PORT set in environment variables. Using 8080");
            return 8080;
        }
    }

    // TODO the env var should be something more generic, like MYSQL_URL
    @Override
    public HikariConfig getHikariConfig() {
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
            log.warn("No CLEARDB_DATABASE_URL set in environment variables. Using hikari.properties");
            return new HikariConfig("hikari.properties");
        }
    }

    @Override
    public String getJwtIssuer() {
        String jwtIssuer = processBuilder.environment().get("JWT_ISSUER");
        if (jwtIssuer != null) {
            return jwtIssuer;
        } else {
            log.warn("No JWT_ISSUER set in environment variables. Using 'http://example.com'");
            return "http://example.com";
        }
    }

    @Override
    public String getJwtSecret() {
        String jwtSecret = processBuilder.environment().get("JWT_SECRET");
        if (jwtSecret != null) {
            return jwtSecret;
        } else {
            log.warn("No JWT_SECRET set in environment variables. Using 'SECRET'");
            return "SECRET";
        }
    }

    // TODO
    @Override
    public String getCrossOriginDomains() {
        return null;
    }

    @Override
    public org.redisson.config.Config getRedissonConfig() {
        ProcessBuilder processBuilder = new ProcessBuilder();
        org.redisson.config.Config config;
        if (processBuilder.environment().get("REDIS_URL") != null) {
            String redisUrl = processBuilder.environment().get("REDIS_URL");

            String password = redisUrl.substring(redisUrl.indexOf(':', redisUrl.indexOf(':') + 1) + 1, redisUrl.indexOf('@'));

            log.debug(redisUrl);
            log.debug(password);

            config = new org.redisson.config.Config();
            config.useSingleServer().setAddress(redisUrl).setPassword(password);
        } else {
            log.warn("No REDIS_URL set in environment variables. Using redissonConfig.json");
            try {
                config = org.redisson.config.Config.fromJSON(new File("redissonConfig.json"));
            } catch (IOException e) {
                e.printStackTrace();
                return null;
            }
        }
        return config;
    }
}
