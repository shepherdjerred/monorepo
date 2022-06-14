package com.shepherdjerred.funsheet.controller.payloads;

import lombok.Getter;
import lombok.Setter;

public class LoginPayload implements Payload {

    @Getter
    @Setter
    private String username;
    @Getter
    @Setter
    private String password;

    @Override
    public boolean isValid() {
        if (password.length() < 8) {
            return false;
        }
        if (password.equals(username)) {
            return false;
        }
        return true;
    }
}
