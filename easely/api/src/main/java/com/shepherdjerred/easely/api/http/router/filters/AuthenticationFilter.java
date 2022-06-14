package com.shepherdjerred.easely.api.http.router.filters;

import com.auth0.jwt.JWTVerifier;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.exceptions.JWTVerificationException;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.shepherdjerred.easely.api.config.EaselyConfig;
import com.shepherdjerred.easely.api.model.User;
import com.shepherdjerred.easely.api.storage.Store;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;
import spark.Filter;
import spark.Request;
import spark.Response;

import java.io.UnsupportedEncodingException;
import java.util.Optional;
import java.util.UUID;

import static spark.Spark.halt;

@Log4j2
@AllArgsConstructor
public class AuthenticationFilter implements Filter {

    private Store store;
    private EaselyConfig easelyConfig;

    @Override
    public void handle(Request request, Response response) {
        log.debug("Attempting to validate request");

        if (request.requestMethod().equals("OPTIONS")) {
            return;
        }

        DecodedJWT jwt;
        try {
            Algorithm algorithm = Algorithm.HMAC256(easelyConfig.getJwtSecret());
            String issuer = easelyConfig.getJwtIssuer();
            JWTVerifier verifier = com.auth0.jwt.JWT.require(algorithm)
                    .withIssuer(issuer)
                    .build();
            jwt = verifier.verify(request.headers("Authorization").replace("Bearer ", ""));
        } catch (JWTVerificationException e) {
            log.error(e);
            throw halt(401);
        } catch (UnsupportedEncodingException e) {
            log.error(e);
            throw halt(500);
        }
        Optional<User> user = store.getUser(UUID.fromString(jwt.getClaim("uuid").asString()));
        log.debug("User validated: " + user.get().getEmail());
        request.attribute("user", user.get());
    }
}
