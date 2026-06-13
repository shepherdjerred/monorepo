package com.shepherdjerred.funsheet.objects;

import lombok.*;

import java.util.UUID;

@ToString
@EqualsAndHashCode
public class Location {

    @Getter
    @Setter
    private String name;
    @Getter
    private final UUID uuid;
    @Getter
    @Setter
    private String placeId;

    public Location(String name, UUID uuid, String placeId) {
        this.name = name;
        this.uuid = uuid;
        this.placeId = placeId;
    }

}
