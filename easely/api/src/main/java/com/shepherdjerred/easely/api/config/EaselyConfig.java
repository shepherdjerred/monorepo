package com.shepherdjerred.easely.api.config;

import com.zaxxer.hikari.HikariConfig;

public interface EaselyConfig {
    int getServerPort();

    HikariConfig getHikariConfig();

    String getJwtIssuer();

    String getJwtSecret();

    String getCrossOriginDomains();

    org.redisson.config.Config getRedissonConfig();
}
