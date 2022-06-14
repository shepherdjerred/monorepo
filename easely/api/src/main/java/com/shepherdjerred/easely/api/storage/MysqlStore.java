package com.shepherdjerred.easely.api.storage;

import com.shepherdjerred.easely.api.model.User;
import com.shepherdjerred.easely.api.storage.database.Database;
import com.shepherdjerred.easely.api.storage.database.dao.UserDAO;
import com.shepherdjerred.easely.api.storage.database.dao.UserMysqlDAO;
import lombok.Getter;
import lombok.extern.log4j.Log4j2;

import java.util.Optional;
import java.util.UUID;

@Log4j2
public class MysqlStore implements Store {

    @Getter
    private final Database database;
    private final UserDAO userDAO;

    public MysqlStore(Database database) {
        this.database = database;
        userDAO = new UserMysqlDAO(database.getDataSource());
    }

    @Override
    public void addUser(User user) {
        userDAO.insert(user);
    }

    @Override
    public Optional<User> getUser(UUID uuid) {
        return userDAO.select(uuid);
    }

    @Override
    public boolean isEmailTaken(String email) {
        return userDAO.select(email).isPresent();
    }

    @Override
    public UUID getUserUuid(String email) {
        Optional<User> user = userDAO.select(email);
        if (user.isPresent()) {
            return user.get().getUuid();
        } else {
            return null;
        }
    }
}
