package com.shepherdjerred.funsheet.controller.payloads.tag;

import com.shepherdjerred.funsheet.controller.payloads.Payload;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;

@ToString
@EqualsAndHashCode
public class NewTagPayload implements Payload {

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
