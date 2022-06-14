package com.shepherdjerred.funsheet.storage;

import com.shepherdjerred.funsheet.objects.*;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

public interface Store {

    void addUser(User user);
    Optional<User> getUser(UUID uuid);
    boolean isUsernameTaken(String username);
    UUID getUserUuid(String name);

    void addActivity(Activity activity);
    Optional<Activity> getActivity(UUID uuid);
    Collection<Activity> getActivities();
    void deleteActivity(UUID uuid);
    void updateActivity(Activity activity);
    boolean isActivityNameTaken(String name);

    void addTag(Tag tag);
    Optional<Tag> getTag(UUID uuid);
    Collection<Tag> getTags();
    void deleteTag(UUID uuid);
    void updateTag(Tag tag);
    boolean isTagNameTaken(String name);

    void addType(Type type);
    Optional<Type> getType(UUID uuid);
    Collection<Type> getTypes();
    void deleteType(UUID uuid);
    void updateType(Type type);
    boolean isTypeNameTaken(String name);

    void addLocation(Location location);
    Optional<Location> getLocation(UUID uuid);
    Collection<Location> getLocations();
    void deleteLocation(UUID uuid);
    void updateLocation(Location location);
    boolean isLocationNameTaken(String name);

}
