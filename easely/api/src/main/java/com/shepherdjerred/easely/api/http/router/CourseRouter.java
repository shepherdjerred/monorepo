package com.shepherdjerred.easely.api.http.router;

import com.shepherdjerred.easely.api.config.EaselyConfig;
import com.shepherdjerred.easely.api.easel.datasource.EaselDataSource;
import com.shepherdjerred.easely.api.http.controller.CourseController;
import com.shepherdjerred.easely.api.http.router.filters.AuthenticationFilter;
import com.shepherdjerred.easely.api.model.User;
import com.shepherdjerred.easely.api.storage.Store;
import lombok.extern.log4j.Log4j2;

import static spark.Spark.*;

@Log4j2
public class CourseRouter implements Router {

    private CourseController courseController;
    private Store store;
    private EaselyConfig easelyConfig;

    public CourseRouter(Store store, EaselDataSource easelDataSource, EaselyConfig easelyConfig) {
        this.store = store;
        courseController = new CourseController(easelDataSource);
        this.easelyConfig = easelyConfig;
    }

    public void setupRoutes() {
        before("/api/courses", new AuthenticationFilter(store, easelyConfig));

        get("/api/courses", (request, response) -> {
            response.type("application/json");

            User user;

            if (request.attribute("user") instanceof User) {
                user = request.attribute("user");
            } else {
                log.debug("Error getting user attribute from request");
                internalServerError("Error getting user attribute from request");
                return "";
            }

            return courseController.getCoursesForUser(user);
        }, new JsonTransformer());
    }

}
