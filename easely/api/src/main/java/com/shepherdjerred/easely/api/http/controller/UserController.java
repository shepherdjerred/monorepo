package com.shepherdjerred.easely.api.http.controller;

import com.shepherdjerred.easely.api.model.User;
import com.shepherdjerred.easely.api.storage.Store;
import lombok.extern.log4j.Log4j2;
import org.mindrot.jbcrypt.BCrypt;

import javax.security.auth.login.FailedLoginException;
import java.util.EnumSet;
import java.util.Optional;
import java.util.UUID;

@Log4j2
public class UserController {
    private Store store;

    public UserController(Store store) {
        this.store = store;
    }

    public User login(String email, String password) throws FailedLoginException {
        UUID userUuid = store.getUserUuid(email);
        Optional<User> userToAuthAs = store.getUser(userUuid);

        if (!userToAuthAs.isPresent()) {
            throw new FailedLoginException("User does not exist");
        }

        if (!userToAuthAs.get().authenticate(password)) {
            throw new FailedLoginException("Incorrect password");
        }

        return userToAuthAs.get();
    }

    // TODO validation should be done here instead of in payload
    public User register(String email, String password, String easelUsername, String easelPassword) {

        User user = new User(UUID.randomUUID(),
                email,
                BCrypt.hashpw(password, BCrypt.gensalt()),
                easelUsername,
                easelPassword,
                EnumSet.noneOf(User.Permission.class));

        store.addUser(user);

        return user;
    }

}
