package com.shepherdjerred.funsheet.controller;

import com.auth0.jwt.exceptions.JWTVerificationException;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shepherdjerred.funsheet.JWTHelper;
import com.shepherdjerred.funsheet.objects.Activity;
import com.shepherdjerred.funsheet.objects.Location;
import com.shepherdjerred.funsheet.objects.Type;
import com.shepherdjerred.funsheet.controller.payloads.activity.EditActivityPayload;
import com.shepherdjerred.funsheet.controller.payloads.activity.NewActivityPayload;
import com.shepherdjerred.funsheet.storage.Store;
import lombok.extern.log4j.Log4j2;

import java.io.UnsupportedEncodingException;
import java.util.Optional;
import java.util.UUID;

import static spark.Spark.*;

@Log4j2
public class ActivityController implements Controller {

    private Store store;
    private static ObjectMapper objectMapper = new ObjectMapper();

    public ActivityController(Store store) {
        this.store = store;
    }

    public void setupRoutes() {

        get("/api/activities", (request, response) -> {
            response.type("application/json");

            return objectMapper.writeValueAsString(store.getActivities());
        });

        get("/api/activities/:activity", (request, response) -> {
            response.type("application/json");

            String activityParam = request.params().get(":activity");
            UUID activityUuid = UUID.fromString(activityParam);
            Optional<Activity> activity = store.getActivity(activityUuid);

            if (activity.isPresent()) {
                return objectMapper.writeValueAsString(activity.get());
            } else {
                response.status(404);
                return "";
            }
        });

        post("/api/activities", (request, response) -> {
            response.type("application/json");

            NewActivityPayload activityPayload = objectMapper.readValue(request.body(), NewActivityPayload.class);

            try {
                DecodedJWT jwt = JWTHelper.decodeJwt(activityPayload.getJwt());
            } catch (JWTVerificationException e) {
                response.status(401);
                return "";
            } catch (UnsupportedEncodingException e) {
                response.status(500);
                return "";
            }

            if (!activityPayload.isValid()) {
                response.status(400);
                return "";
            }

            if (store.isActivityNameTaken(activityPayload.getName())) {
                response.status(400);
                return "";
            }

            Type type = null;
            if (activityPayload.getType() != null) {
                Optional<Type> typeOptional = store.getType(activityPayload.getType());
                if (typeOptional.isPresent()) {
                    type = typeOptional.get();
                } else {
                    response.status(400);
                    return "";
                }
            }

            Location location = null;
            if (activityPayload.getLocation() != null) {
                Optional<Location> locationOptional = store.getLocation(activityPayload.getLocation());
                if (locationOptional.isPresent()) {
                    location = locationOptional.get();
                } else {
                    response.status(400);
                    return "";
                }
            }

            Activity activity = new Activity(
                    activityPayload.getName(),
                    UUID.randomUUID(),
                    type,
                    activityPayload.getRating(),
                    location,
                    activityPayload.getCost(),
                    activityPayload.getDescription()
            );

            store.addActivity(activity);

            return objectMapper.writeValueAsString(activity);
        });

        patch("/api/activities/:activity", (request, response) -> {
            response.type("application/json");

            EditActivityPayload activityPayload = objectMapper.readValue(request.body(), EditActivityPayload.class);

            try {
                DecodedJWT jwt = JWTHelper.decodeJwt(activityPayload.getJwt());
            } catch (JWTVerificationException e) {
                response.status(401);
                return "";
            } catch (UnsupportedEncodingException e) {
                response.status(500);
                return "";
            }

            if (!activityPayload.isValid()) {
                response.status(400);
                return "";
            }

            Optional<Activity> activityOptional = store.getActivity(activityPayload.getUuid());

            if (activityOptional.isPresent()) {
                Activity activity = activityOptional.get();

                if (activityPayload.getName() != null) {
                    if (store.isActivityNameTaken(activityPayload.getName()) && !activity.getName().equals(activityPayload.getName())) {
                        response.status(400);
                        return "";
                    }
                    activity.setName(activityPayload.getName());
                }

                if (activityPayload.getType() != null) {
                    Optional<Type> typeOptional = store.getType(activityPayload.getType());
                    if (typeOptional.isPresent()) {
                        activity.setType(typeOptional.get());
                    } else {
                        response.status(400);
                        return "";
                    }
                }

                if (activityPayload.getRating() != null) {
                    activity.setRating(activityPayload.getRating());
                }

                if (activityPayload.getLocation() != null) {
                    Optional<Location> locationOptional = store.getLocation(activityPayload.getLocation());
                    if (locationOptional.isPresent()) {
                        activity.setLocation(locationOptional.get());
                    } else {
                        response.status(400);
                        return "";
                    }
                }

                if (activityPayload.getCost() != null) {
                    activity.setCost(activityPayload.getCost());
                }

                if (activityPayload.getDescription() != null) {
                    activity.setDescription(activityPayload.getDescription());
                }

                store.updateActivity(activity);

                return objectMapper.writeValueAsString(activity);
            } else {
                response.status(400);
                return "";
            }
        });

        delete("/api/activities/:activity", (request, response) -> {
            response.type("application/json");

            // TODO auth

            String activityParam = request.params().get(":activity");
            UUID activityUuid = UUID.fromString(activityParam);

            store.deleteActivity(activityUuid);

            return "";
        });
    }

}
