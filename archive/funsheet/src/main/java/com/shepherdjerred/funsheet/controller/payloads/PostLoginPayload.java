package com.shepherdjerred.funsheet.controller.payloads;

import lombok.Getter;
import lombok.Setter;

public class PostLoginPayload {

    @Getter
    @Setter
    private final String jsonWebToken;

    public PostLoginPayload(String jsonWebToken) {
        this.jsonWebToken = jsonWebToken;
    }
}
