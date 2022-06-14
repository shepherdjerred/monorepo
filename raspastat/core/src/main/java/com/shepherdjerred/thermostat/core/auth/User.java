package com.shepherdjerred.thermostat.core.auth;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

public class User {

    private static Map<UUID, User> users = new HashMap<>();
    private String username;
    private String password;
    private UUID uuid;

    public User(String username, String password, UUID uuid) {
        this.username = username;
        this.password = password;
        this.uuid = uuid;
    }

    public String getUsername() {
        return username;
    }

    public String getPassword() {
        return password;
    }

    public UUID getUuid() {
        return uuid;
    }

    public static UUID getUuidFromUsername(String username) {
        for (User user : users.values())
            if (user.getUsername().equalsIgnoreCase(username))
                return user.getUuid();
        return null;
    }

    public static User getUser(UUID uuid) {
        return users.get(uuid);
    }

    public boolean authenticate(String password) {
        return this.password.equals(password);
    }
}