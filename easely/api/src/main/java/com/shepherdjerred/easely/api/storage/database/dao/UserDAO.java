package com.shepherdjerred.easely.api.storage.database.dao;

import com.shepherdjerred.easely.api.model.User;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

public interface UserDAO {
    Optional<User> select(String name);

    Optional<User> select(UUID uuid);

    Collection<User> select();

    void insert(User user);

    void drop(User user);

    void update(User type);
}
