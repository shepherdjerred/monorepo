package com.shepherdjerred.funsheet.objects;

import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;

import java.util.UUID;

@ToString
@EqualsAndHashCode
public class Tag {

    @Getter
    @Setter
    private String name;
    @Getter
    private final UUID uuid;

    public Tag(String name, UUID uuid) {
        this.name = name;
        this.uuid = uuid;
    }
}
