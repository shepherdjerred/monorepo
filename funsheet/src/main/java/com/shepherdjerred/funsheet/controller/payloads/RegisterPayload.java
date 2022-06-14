package com.shepherdjerred.funsheet.controller.payloads;

import lombok.Getter;
import lombok.Setter;

public class RegisterPayload implements Payload {

    @Getter
    @Setter
    private String username;
    @Getter
    @Setter
    private String password;
    @Getter
    @Setter
    private String referrer;


    @Override
    public boolean isValid() {
        if (password.length() < 8) {
            return false;
        }
        if (password.equals(username)) {
            return false;
        }
        if (referrer.matches("/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/")) {
            return false;
        }
        return true;
    }
}
