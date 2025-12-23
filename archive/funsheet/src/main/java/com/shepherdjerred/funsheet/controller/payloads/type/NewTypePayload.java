package com.shepherdjerred.funsheet.controller.payloads.type;

import com.shepherdjerred.funsheet.controller.payloads.Payload;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;

import java.util.List;
import java.util.UUID;

@ToString
@EqualsAndHashCode
public class NewTypePayload implements Payload {

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
