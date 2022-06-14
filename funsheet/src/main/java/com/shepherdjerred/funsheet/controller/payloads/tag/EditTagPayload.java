package com.shepherdjerred.funsheet.controller.payloads.tag;

import com.shepherdjerred.funsheet.controller.payloads.Payload;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

public class EditTagPayload implements Payload {

    @Getter
    @Setter
    private UUID uuid;
    @Getter
    @Setter
    private String name;
    @Getter
    @Setter
    private String jwt;

    @Override
    public boolean isValid() {
        return true;
    }
}
