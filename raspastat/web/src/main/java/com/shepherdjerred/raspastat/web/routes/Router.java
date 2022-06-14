package com.shepherdjerred.raspastat.web.routes;

import com.shepherdjerred.raspastat.web.api.Set;
import com.shepherdjerred.raspastat.web.api.Status;
import com.shepherdjerred.raspastat.web.util.template.ThymeleafTemplateEngine;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import spark.ModelAndView;

import java.util.HashMap;
import java.util.Map;

import static spark.Spark.get;
import static spark.Spark.post;

public class Router {

    public void setupRoutes() {
        get("/", (request, response) -> {
            Map<String, String> model = new HashMap<>();
            return new ModelAndView(model, "index");
        }, new ThymeleafTemplateEngine());

        post("/api/set", (request, response) -> {
            JSONObject requestJson = (JSONObject) new JSONParser().parse(request.body());
            JSONObject responseJson = new JSONObject();

            if (requestJson.get("operation") == null) {
                responseJson.put("message", "operation field wasn't sent");
                responseJson.put("success", false);
                response.status(400);
                response.type("application/json");
                return responseJson.toJSONString();
            }

            switch ((String) requestJson.get("operation")) {
                case "temp":
                    return new Set().setTemp(request, response);
            }

            responseJson.put("message", "invalid operation");
            responseJson.put("success", false);
            response.status(400);
            response.type("application/json");
            return responseJson.toJSONString();
        });

        get("/api/status", (request, response) -> {
            response.type("application/json");
            return new Status().getStatus().toJSONString();
        });
    }

}
