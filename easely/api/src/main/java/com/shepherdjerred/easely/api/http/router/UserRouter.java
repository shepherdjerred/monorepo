package com.shepherdjerred.easely.api.http.router;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.exceptions.JWTCreationException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shepherdjerred.easely.api.config.EaselyConfig;
import com.shepherdjerred.easely.api.http.controller.UserController;
import com.shepherdjerred.easely.api.http.controller.payload.LoginRequestPayload;
import com.shepherdjerred.easely.api.http.controller.payload.LoginResponsePayload;
import com.shepherdjerred.easely.api.http.controller.payload.RegisterRequestPayload;
import com.shepherdjerred.easely.api.model.User;
import com.shepherdjerred.easely.api.storage.Store;
import lombok.extern.log4j.Log4j2;

import javax.security.auth.login.FailedLoginException;
import java.io.UnsupportedEncodingException;

import static spark.Spark.post;

@Log4j2
public class UserRouter implements Router {

    private static ObjectMapper objectMapper = new ObjectMapper();
    private UserController userController;
    private EaselyConfig easelyConfig;

    public UserRouter(Store store, EaselyConfig easelyConfig) {
        this.userController = new UserController(store);
        this.easelyConfig = easelyConfig;
    }

    @Override
    public void setupRoutes() {
        post("/api/user/login", (request, response) -> {
            log.debug("Attempting to login");
            response.type("application/json");

            LoginRequestPayload loginRequestPayload = objectMapper.readValue(request.body(), LoginRequestPayload.class);

            if (!loginRequestPayload.isValid()) {
                response.status(400);
                log.error("Payload not valid");
                // TODO
                return "";
            }

            User user;
            try {
                user = userController.login(loginRequestPayload.getEmail(), loginRequestPayload.getPassword());
            } catch (FailedLoginException e) {
                log.error(e);
                // TODO
                return "";
            }

            try {
                Algorithm algorithm = Algorithm.HMAC256(easelyConfig.getJwtSecret());
                String token = JWT.create()
                        .withIssuer(easelyConfig.getJwtIssuer())
                        .withClaim("email", loginRequestPayload.getEmail())
                        .withClaim("uuid", String.valueOf(user.getUuid()))
                        .withClaim("easelUsername", user.getEaselUsername())
                        .sign(algorithm);
                return new LoginResponsePayload(token);
            } catch (UnsupportedEncodingException | JWTCreationException exception) {
                response.status(500);
                return objectMapper.writeValueAsString(exception.getMessage());
            }
        }, new JsonTransformer());

        post("/api/user/register", (request, response) -> {
            response.type("application/json");

            RegisterRequestPayload registerRequestPayload = objectMapper.readValue(request.body(), RegisterRequestPayload.class);

            if (!registerRequestPayload.isValid()) {
                response.status(400);
                return "";
            }

            User user = userController.register(registerRequestPayload.getEmail(), registerRequestPayload.getPassword(), registerRequestPayload.getEaselUsername(), registerRequestPayload.getEaselPassword());

            try {
                Algorithm algorithm = Algorithm.HMAC256(easelyConfig.getJwtSecret());
                String token = JWT.create()
                        .withIssuer(easelyConfig.getJwtIssuer())
                        .withClaim("email", registerRequestPayload.getEmail())
                        .withClaim("uuid", String.valueOf(user.getUuid()))
                        .withClaim("easelUsername", user.getEaselUsername())
                        .sign(algorithm);
                return objectMapper.writeValueAsString(new LoginResponsePayload(token));
            } catch (UnsupportedEncodingException | JWTCreationException exception) {
                response.status(500);
                return objectMapper.writeValueAsString(exception.getMessage());
            }

        }, new JsonTransformer());
    }
}
