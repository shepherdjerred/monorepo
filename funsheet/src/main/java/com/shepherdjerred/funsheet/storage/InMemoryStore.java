package com.shepherdjerred.funsheet.storage;

import com.shepherdjerred.funsheet.objects.*;
import lombok.ToString;

import java.util.*;

@ToString
public class InMemoryStore implements Store {

    private Map<UUID, User> users;
    private Map<UUID, Tag> tags;
    private Map<UUID, Type> types;
    private Map<UUID, Location> locations;
    private Map<UUID, Activity> activities;

    public InMemoryStore() {
        users = new HashMap<>();
        tags = new HashMap<>();
        types = new HashMap<>();
        locations = new HashMap<>();
        activities = new HashMap<>();
    }

    @Override
    public void addUser(User user) {
        users.put(user.getUuid(), user);
    }

    public Optional<User> getUser(UUID uuid) {
        return Optional.ofNullable(users.get(uuid));
    }

    @Override
    public boolean isUsernameTaken(String username) {
        for (User user : users.values()) {
            if (user.getUsername().equals(username)) {
                return true;
            }
        }
        return false;
    }

    @Override
    public UUID getUserUuid(String username) {
        for (User user : users.values()) {
            if (user.getUsername().equals(username)) {
                return user.getUuid();
            }
        }
        return null;
    }

    @Override
    public void addActivity(Activity activity) {
        activities.put(activity.getUuid(), activity);
    }

    @Override
    public Optional<Activity> getActivity(UUID uuid) {
        return Optional.ofNullable(activities.get(uuid));
    }

    @Override
    public Collection<Activity> getActivities() {
        return activities.values();
    }

    @Override
    public void deleteActivity(UUID uuid) {
        activities.remove(uuid);
    }

    @Override
    public void updateActivity(Activity activity) {
        // Nothing needs to be done
    }

    @Override
    public boolean isActivityNameTaken(String name) {
        for (Activity activity : activities.values()) {
            if (activity.getName().equals(name)) {
                return true;
            }
        }
        return false;
    }

    @Override
    public void addTag(Tag tag) {
        tags.put(tag.getUuid(), tag);
    }

    @Override
    public Optional<Tag> getTag(UUID uuid) {
        return Optional.ofNullable(tags.get(uuid));
    }

    @Override
    public Collection<Tag> getTags() {
        return tags.values();
    }

    @Override
    public void deleteTag(UUID uuid) {
        tags.remove(uuid);
    }

    @Override
    public void updateTag(Tag tag) {
        // Nothing needs to be done
    }

    @Override
    public boolean isTagNameTaken(String name) {
        for (Tag tag : tags.values()) {
            if (tag.getName().equals(name)) {
                return true;
            }
        }
        return false;
    }

    @Override
    public void addType(Type type) {
        types.put(type.getUuid(), type);
    }

    @Override
    public Optional<Type> getType(UUID uuid) {
        return Optional.ofNullable(types.get(uuid));
    }

    @Override
    public Collection<Type> getTypes() {
        return types.values();
    }

    @Override
    public void deleteType(UUID uuid) {
        types.remove(uuid);
    }

    @Override
    public void updateType(Type type) {
        // Nothing needs to be done
    }

    @Override
    public boolean isTypeNameTaken(String name) {
        for (Type type : types.values()) {
            if (type.getName().equals(name)) {
                return true;
            }
        }
        return false;
    }

    @Override
    public void addLocation(Location location) {
        locations.put(location.getUuid(), location);
    }

    @Override
    public Optional<Location> getLocation(UUID uuid) {
        return Optional.ofNullable(locations.get(uuid));
    }

    @Override
    public Collection<Location> getLocations() {
        return locations.values();
    }

    @Override
    public void deleteLocation(UUID uuid) {
        locations.remove(uuid);
    }

    @Override
    public void updateLocation(Location location) {
        // Nothing needs to be done
    }

    @Override
    public boolean isLocationNameTaken(String name) {
        for (Location location : locations.values()) {
            if (location.getName().equals(name)) {
                return true;
            }
        }
        return false;
    }

}
