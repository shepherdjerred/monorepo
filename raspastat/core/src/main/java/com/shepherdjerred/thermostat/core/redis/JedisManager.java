package com.shepherdjerred.thermostat.core.redis;

import com.shepherdjerred.thermostat.core.Main;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;
import redis.clients.jedis.JedisPoolConfig;

public class JedisManager {

    private static JedisManager jedisManager;
    private JedisPool jedisPool = new JedisPool(new JedisPoolConfig(), "localhost");

    public JedisManager() {
        jedisManager = this;
        new Thread() {
            @Override
            public void run() {
                try (Jedis jedis = jedisPool.getResource()) {
                    jedis.subscribe(new JedisListener(), "api");
                }
            }
        }.start();
    }

    public static JedisManager getJedisManager() {
        return jedisManager;
    }

    public void updateStatus() {
        if (Main.getController() == null || Main.getController().getThermometer() == null) {
            Main.getLogger().info("Null controller/thermometer");
            return;
        }
        if (jedisPool == null)
            Main.getLogger().info("Jedis is null");
        new Thread() {
            @Override
            public void run() {
                try (Jedis jedis = jedisPool.getResource()) {
                    jedis.set("status:target", String.valueOf(Main.getController().getTargetTemp()));
                    jedis.set("status:current", String.valueOf(Main.getController().getThermometer().getTemp()));
                    jedis.set("status:humidity", String.valueOf(Main.getController().getThermometer().getHumidity()));
                    jedis.set("status:mode", String.valueOf(Main.getController().getThermostat().getMode()));
                    jedis.set("status:enabled", String.valueOf(Main.getController().isEnabled()));
                    jedis.set("status:tolerance", String.valueOf(Main.getController().getTolerance()));
                    jedis.set("status:period", String.valueOf(Main.getController().getUpdatePeriod()));
                    jedis.set("status:delay", String.valueOf(Main.getController().getThermometer().getRetryDelay()));
                }
            }
        }.start();
    }

    public JedisPool getJedis() {
        return jedisPool;
    }
}