package com.shepherdjerred.funsheet.objects;

import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;

import java.util.List;
import java.util.UUID;

@ToString
@EqualsAndHashCode
public class Type {

    @Getter
    @Setter
    private String name;
    @Getter
    private final UUID uuid;
    @Getter
    @Setter
    private List<Tag> tags;

    public Type(String name, UUID uuid, List<Tag> tags) {
        this.name = name;
        this.uuid = uuid;
        this.tags = tags;
    }

}
