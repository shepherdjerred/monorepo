package com.shepherdjerred.easely.api.http.controller.payload;

import lombok.Getter;
import lombok.Setter;

public class LoginRequestPayload implements Payload {

    @Getter
    @Setter
    private String email;
    @Getter
    @Setter
    private String password;

    @Override
    public boolean isValid() {
        return true;
    }

}
