package com.shepherdjerred.easely.api.http.controller.payload;

import lombok.AllArgsConstructor;
import lombok.Getter;

@AllArgsConstructor
public class LoginResponsePayload implements Payload {

    @Getter
    private final String jsonWebToken;

    @Override
    public boolean isValid() {
        return true;
    }
}
