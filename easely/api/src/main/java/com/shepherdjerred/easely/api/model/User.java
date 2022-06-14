package com.shepherdjerred.easely.api.model;

import lombok.*;
import org.mindrot.jbcrypt.BCrypt;

import java.util.EnumSet;
import java.util.UUID;

@AllArgsConstructor
@ToString
public class User {

    @Getter
    private final UUID uuid;
    @Getter
    @Setter
    private String email;
    @Getter
    @Setter
    private String hashedPassword;
    @Getter
    @Setter
    private String easelUsername;
    @Getter
    @Setter
    private String easelPassword;
    @Getter
    @Setter
    private EnumSet<Permission> permissions;

    public boolean authenticate(String password) {
        return BCrypt.checkpw(password, hashedPassword);
    }

    public boolean hasPermission(Permission permission) {
        return permissions.contains(permission);
    }

    public enum Permission {
        LIST_USERS, CLEAR_CACHE, DELETE_USER
    }

}
