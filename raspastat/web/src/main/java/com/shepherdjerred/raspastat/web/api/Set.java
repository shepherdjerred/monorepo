package com.shepherdjerred.raspastat.web.api;

import com.shepherdjerred.raspastat.web.util.redis.JedisWrapper;
import org.apache.commons.lang3.StringUtils;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;
import redis.clients.jedis.Jedis;
import spark.Request;
import spark.Response;

import java.util.UUID;

public class Set {

    public String setTemp(Request request, Response response) {
        JSONObject responseJson = new JSONObject();
        JSONObject requestJson;

        try {
            requestJson = (JSONObject) new JSONParser().parse(request.body());
        } catch (ParseException e) {
            e.printStackTrace();
            responseJson.put("message", "error parsing json");
            responseJson.put("success", false);
            response.status(400);
            response.type("application/json");
            return responseJson.toJSONString();
        }

        if (requestJson.get("value") == null) {
            responseJson.put("message", "value field wasn't sent");
            responseJson.put("success", false);
            response.status(400);
            response.type("application/json");
            return responseJson.toJSONString();
        }

        String value = String.valueOf(requestJson.get("value"));

        if (!StringUtils.isNumeric(value)) {
            responseJson.put("message", "value field was not an integer");
            responseJson.put("success", false);
            response.status(400);
            response.type("application/json");
            return responseJson.toJSONString();
        }

        if (Integer.valueOf(value) < 60 || Integer.valueOf(value) > 80) {
            responseJson.put("message", "value field was not between 60-80");
            responseJson.put("success", false);
            response.status(400);
            response.type("application/json");
            return responseJson.toJSONString();
        }

        try (Jedis jedis = JedisWrapper.getJedisPool().getResource()) {
            UUID requestUuid = UUID.randomUUID();
            jedis.set("api#" + requestUuid.toString() + ":operation", "set-temp");
            jedis.set("api#" + requestUuid.toString() + ":value", value);
            jedis.publish("api", requestUuid.toString());
        }

        response.type("application/json");
        responseJson.put("success", true);
        return responseJson.toJSONString();
    }

}
