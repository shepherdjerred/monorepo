package com.shepherdjerred.thermostat.core.redis;

import com.shepherdjerred.thermostat.core.api.Api;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPubSub;

import java.util.UUID;

public class JedisListener extends JedisPubSub {

    public void onMessage(String channel, String message) {

        System.out.println("New message!");

        UUID requestUuid = UUID.fromString(message);
        //User user = User.getUser(User.getUuidFromUsername(JedisManager.getJedisManager().getJedis().getResource().get("api:request#" + requestUuid.toString() + ":username")));

        //if (!user.authenticate(JedisManager.getJedisManager().getJedis().getResource().get("api:request#" + requestUuid.toString() + ":password")))
        //return;


        try (Jedis jedis = JedisManager.getJedisManager().getJedis().getResource()) {
            String operation = jedis.get("api#" + requestUuid.toString() + ":operation");
            String data = jedis.get("api#" + requestUuid.toString() + ":value");

            switch (operation) {
                case "set-temp":
                    Api.setTemperature(null, Integer.valueOf(data));
                    break;
                case "set-tolerance":
                    Api.setTolerance(null, Integer.valueOf(data));
                    break;
                case "set-period":
                    Api.setPeriod(null, Integer.valueOf(data));
                    break;
                case "set-enabled":
                    Api.setEnabled(null, Boolean.valueOf(data));
                    break;
            }
        }

    }

    public void onSubscribe(String channel, int subscribedChannels) {
    }

    public void onUnsubscribe(String channel, int subscribedChannels) {
        System.out.println("Unsub");
    }

    public void onPSubscribe(String pattern, int subscribedChannels) {
    }

    public void onPUnsubscribe(String pattern, int subscribedChannels) {
    }

    public void onPMessage(String pattern, String channel, String message) {
    }


}