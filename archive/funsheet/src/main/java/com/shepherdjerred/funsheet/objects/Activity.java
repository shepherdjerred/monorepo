package com.shepherdjerred.funsheet.objects;

import lombok.*;

import java.util.UUID;

@ToString
@EqualsAndHashCode
public class Activity {

    @Getter
    @Setter
    private String name;
    @Getter
    private final UUID uuid;
    @Getter
    @Setter
    private Type type;
    @Getter
    @Setter
    private int rating;
    @Getter
    @Setter
    private Location location;
    @Getter
    @Setter
    private int cost;
    @Getter
    @Setter
    private String description;

    public Activity(String name, UUID uuid, Type type, int rating, Location location, int cost, String description) {
        this.name = name;
        this.uuid = uuid;
        this.type = type;
        this.rating = rating;
        this.location = location;
        this.cost = cost;
        this.description = description;
    }

}
