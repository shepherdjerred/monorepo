package com.shepherdjerred.funsheet.controller.payloads.activity;

import com.shepherdjerred.funsheet.controller.payloads.Payload;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

public class EditActivityPayload implements Payload {

    @Getter
    @Setter
    private UUID uuid;
    @Getter
    @Setter
    private String name;
    @Getter
    @Setter
    private UUID type;
    @Getter
    @Setter
    private Integer rating;
    @Getter
    @Setter
    private UUID location;
    @Getter
    @Setter
    private Integer cost;
    @Getter
    @Setter
    private String description;
    @Getter
    @Setter
    private String jwt;

    @Override
    public boolean isValid() {
        if (rating != null) {
            if (rating < 1 || rating > 5) {
                return false;
            }
        }

        if (cost != null) {
            if (cost < 0 || cost > 5) {
                return false;
            }
        }

        return true;
    }

}
