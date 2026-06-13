package com.shepherdjerred.funsheet.storage.mysql;

import com.shepherdjerred.funsheet.objects.*;
import com.shepherdjerred.funsheet.storage.Store;
import com.shepherdjerred.funsheet.storage.mysql.dao.*;
import lombok.Getter;
import lombok.extern.log4j.Log4j2;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

@Log4j2
public class MysqlStore implements Store {

    @Getter
    private final Database database;
    private final UserDAO userDAO;
    private final ActivityDAO activityDAO;
    private final LocationDAO locationDAO;
    private final TypeDAO typeDAO;
    private final TagDAO tagDAO;

    public MysqlStore(Database database) {
        this.database = database;
        userDAO = new UserDAO(this);
        activityDAO = new ActivityDAO(this);
        locationDAO = new LocationDAO(this);
        typeDAO = new TypeDAO(this);
        tagDAO = new TagDAO(this);
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
    public boolean isUsernameTaken(String username) {
        return userDAO.select(username).isPresent();
    }

    @Override
    public UUID getUserUuid(String name) {
        Optional<User> user = userDAO.select(name);
        if (user.isPresent()) {
            return user.get().getUuid();
        } else {
            return null;
        }
    }

    @Override
    public void addActivity(Activity activity) {
        activityDAO.insert(activity);
    }

    @Override
    public Optional<Activity> getActivity(UUID uuid) {
        return activityDAO.select(uuid);
    }

    @Override
    public Collection<Activity> getActivities() {
        return activityDAO.select();
    }

    @Override
    public void deleteActivity(UUID uuid) {
        Optional<Activity> activity = getActivity(uuid);
        activity.ifPresent(activityDAO::drop);
    }

    @Override
    public void updateActivity(Activity activity) {
        activityDAO.update(activity);
    }

    @Override
    public boolean isActivityNameTaken(String name) {
        return activityDAO.select(name).isPresent();
    }

    @Override
    public void addTag(Tag tag) {
        tagDAO.insert(tag);
    }

    @Override
    public Optional<Tag> getTag(UUID uuid) {
        return tagDAO.select(uuid);
    }

    @Override
    public Collection<Tag> getTags() {
        return tagDAO.select();
    }

    @Override
    public void deleteTag(UUID uuid) {
        Optional<Tag> tag = getTag(uuid);
        tag.ifPresent(tagDAO::drop);
    }

    @Override
    public void updateTag(Tag tag) {
        tagDAO.update(tag);
    }

    @Override
    public boolean isTagNameTaken(String name) {
        return tagDAO.select(name).isPresent();
    }

    public Collection<Tag> getTagsOfType(UUID typeUuid) {
        return tagDAO.selectTagsOfType(typeUuid);
    }

    @Override
    public void addType(Type type) {
        typeDAO.insert(type);
    }

    @Override
    public Optional<Type> getType(UUID uuid) {
        return typeDAO.select(uuid);
    }

    @Override
    public Collection<Type> getTypes() {
        return typeDAO.select();
    }

    @Override
    public void deleteType(UUID uuid) {
        Optional<Type> type = getType(uuid);
        type.ifPresent(typeDAO::drop);
    }

    @Override
    public void updateType(Type type) {
        typeDAO.update(type);
    }

    @Override
    public boolean isTypeNameTaken(String name) {
        return typeDAO.select(name).isPresent();
    }

    @Override
    public void addLocation(Location location) {
        locationDAO.insert(location);
    }

    @Override
    public Optional<Location> getLocation(UUID uuid) {
        return locationDAO.select(uuid);
    }

    @Override
    public Collection<Location> getLocations() {
        return locationDAO.select();
    }

    @Override
    public void deleteLocation(UUID uuid) {
        Optional<Location> location = getLocation(uuid);
        location.ifPresent(locationDAO::drop);
    }

    @Override
    public void updateLocation(Location location) {
        locationDAO.update(location);
    }

    @Override
    public boolean isLocationNameTaken(String name) {
        return locationDAO.select(name).isPresent();
    }

}
