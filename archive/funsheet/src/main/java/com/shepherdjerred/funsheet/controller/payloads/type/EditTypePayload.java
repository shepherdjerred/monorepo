package com.shepherdjerred.funsheet.controller.payloads.type;

import com.shepherdjerred.funsheet.controller.payloads.Payload;
import lombok.Getter;
import lombok.Setter;

import java.util.List;
import java.util.UUID;

public class EditTypePayload implements Payload {

    @Getter
    @Setter
    private UUID uuid;
    @Getter
    @Setter
    private String name;
    @Getter
    @Setter
    private List<UUID> tags;
    @Getter
    @Setter
    private String jwt;

    @Override
    public boolean isValid() {
        return true;
    }
}
