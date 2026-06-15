package com.shepherdjerred.funsheet.controller.payloads.location;

import com.shepherdjerred.funsheet.controller.payloads.Payload;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;

@ToString
@EqualsAndHashCode
public class NewLocationPayload implements Payload {

    @Getter
    @Setter
    private String name;
    @Getter
    @Setter
    private String placeId;
    @Getter
    @Setter
    private String jwt;

    @Override
    public boolean isValid() {
        return true;
    }
}
