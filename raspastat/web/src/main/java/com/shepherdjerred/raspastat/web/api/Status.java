package com.shepherdjerred.raspastat.web.api;

import com.shepherdjerred.raspastat.web.util.redis.JedisWrapper;
import org.json.simple.JSONObject;
import redis.clients.jedis.Jedis;

public class Status {

    public JSONObject getStatus() {
        JSONObject json = new JSONObject();
        try (Jedis jedis = JedisWrapper.getJedisPool().getResource()) {
            json.put("target", Double.valueOf(jedis.get("status:target")));
            json.put("current", Float.valueOf(jedis.get("status:current")));
            json.put("hudmitity", Float.valueOf(jedis.get("status:humidity")));
            json.put("mode", jedis.get("status:mode"));
            json.put("enabled", Boolean.valueOf(jedis.get("status:enabled")));
            json.put("tolerance", Double.valueOf(jedis.get("status:tolerance")));
            json.put("period", Long.valueOf(jedis.get("status:period")));
            json.put("delay", Long.valueOf(jedis.get("status:delay")));
        }
        return json;
    }

}
