package com.shepherdjerred.funsheet.controller;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.exceptions.JWTCreationException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shepherdjerred.funsheet.objects.User;
import com.shepherdjerred.funsheet.controller.payloads.LoginPayload;
import com.shepherdjerred.funsheet.controller.payloads.PostLoginPayload;
import com.shepherdjerred.funsheet.controller.payloads.RegisterPayload;
import com.shepherdjerred.funsheet.storage.Store;
import org.mindrot.jbcrypt.BCrypt;

import java.io.UnsupportedEncodingException;
import java.util.Optional;
import java.util.UUID;

import static spark.Spark.post;

public class UserController implements Controller {

    private Store store;
    private static ObjectMapper objectMapper = new ObjectMapper();

    public UserController(Store store) {
        this.store = store;
    }

    @Override
    public void setupRoutes() {
        post("/api/user/login", (request, response) -> {
            response.type("application/json");

            LoginPayload loginPayload = objectMapper.readValue(request.body(), LoginPayload.class);

            if (!loginPayload.isValid()) {
                response.status(400);
                return "";
            }

            UUID userUuid = store.getUserUuid(loginPayload.getUsername());
            Optional<User> userToAuthTo = store.getUser(userUuid);

            if (userToAuthTo.isPresent()) {
                if (userToAuthTo.get().authenticate(loginPayload.getPassword())) {
                    try {
                        ProcessBuilder processBuilder = new ProcessBuilder();
                        Algorithm algorithm = Algorithm.HMAC256(processBuilder.environment().get("JWT_SECRET"));
                        String token = JWT.create()
                                .withIssuer("http://funsheet.herokuapp.com")
                                .withClaim("username", loginPayload.getUsername())
                                .withClaim("uuid", String.valueOf(userUuid))
                                .sign(algorithm);
                        return objectMapper.writeValueAsString(new PostLoginPayload(token));
                    } catch (UnsupportedEncodingException | JWTCreationException exception) {
                        response.status(500);
                        return objectMapper.writeValueAsString(exception.getMessage());
                    }
                }

                response.status(401);
                return "";
            }
            response.status(404);
            return "";
        });

        post("/api/user/register", (request, response) -> {
            response.type("application/json");

            RegisterPayload registerPayload = objectMapper.readValue(request.body(), RegisterPayload.class);

            if (!registerPayload.isValid()) {
                response.status(400);
                return "";
            }

            String registerKey = new ProcessBuilder().environment().get("REGISTER_KEY");

            if (!store.getUser(UUID.fromString(registerPayload.getReferrer())).isPresent() && !registerPayload.getReferrer().equals(registerKey)) {
                response.status(400);
                return "";
            }

            User user = new User(
                    UUID.randomUUID(),
                    registerPayload.getUsername(),
                    BCrypt.hashpw(registerPayload.getPassword(), BCrypt.gensalt())
            );

            store.addUser(user);

            try {
                ProcessBuilder processBuilder = new ProcessBuilder();
                Algorithm algorithm = Algorithm.HMAC256(processBuilder.environment().get("JWT_SECRET"));
                String token = JWT.create()
                        .withIssuer("http://funsheet.herokuapp.com")
                        .withClaim("username", registerPayload.getUsername())
                        .withClaim("uuid", String.valueOf(user.getUuid()))
                        .sign(algorithm);
                return objectMapper.writeValueAsString(new PostLoginPayload(token));
            } catch (UnsupportedEncodingException | JWTCreationException exception) {
                response.status(500);
                return objectMapper.writeValueAsString(exception.getMessage());
            }
        });
    }

}
