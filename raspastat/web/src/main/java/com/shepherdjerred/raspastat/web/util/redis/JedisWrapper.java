package com.shepherdjerred.raspastat.web.util.redis;

import redis.clients.jedis.JedisPool;
import redis.clients.jedis.JedisPoolConfig;

public class JedisWrapper {

    private static JedisPool jedisPool = new JedisPool(new JedisPoolConfig(), "localhost");
    public static JedisPool getJedisPool() {
        return jedisPool;
    }

}