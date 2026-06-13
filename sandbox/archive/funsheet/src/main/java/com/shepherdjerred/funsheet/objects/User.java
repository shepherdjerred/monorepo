package com.shepherdjerred.funsheet.objects;

import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;
import org.mindrot.jbcrypt.BCrypt;

import java.util.UUID;

@ToString
@EqualsAndHashCode
public class User {

    @Getter
    private final UUID uuid;
    @Getter
    @Setter
    private String username;
    @Getter
    @Setter
    private String hashedPassword;

    public User(UUID uuid, String username, String hashedPassword) {
        this.uuid = uuid;
        this.username = username;
        this.hashedPassword = hashedPassword;
    }

    public boolean authenticate(String password) {
        return BCrypt.checkpw(password, hashedPassword);
    }
}
