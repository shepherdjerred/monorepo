package com.shepherdjerred.funsheet;

import com.auth0.jwt.JWTVerifier;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.exceptions.JWTVerificationException;
import com.auth0.jwt.interfaces.DecodedJWT;

import java.io.UnsupportedEncodingException;

public class JWTHelper {

    public static DecodedJWT decodeJwt(String jwt) throws UnsupportedEncodingException, JWTVerificationException {
        Algorithm algorithm = Algorithm.HMAC256(new ProcessBuilder().environment().get("JWT_SECRET"));
        String issuer = "http://funsheet.herokuapp.com";
        JWTVerifier verifier = com.auth0.jwt.JWT.require(algorithm)
                .withIssuer(issuer)
                .build();
        return verifier.verify(jwt);
    }

}
