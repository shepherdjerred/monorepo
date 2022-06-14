package com.shepherdjerred.funsheet.storage.mysql.dao;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

public interface DAO<T> {
    Optional<T> select(UUID uuid);

    Collection<T> select();

    void insert(T type);

    void drop(T type);

    void update(T type);
}
