package com.shepherdjerred.easely.api.easel.datasource;

import com.shepherdjerred.easely.api.easel.cache.Cache;
import com.shepherdjerred.easely.api.model.Assignment;
import com.shepherdjerred.easely.api.model.Course;
import com.shepherdjerred.easely.api.model.User;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;

import java.util.Collection;

@Log4j2
@AllArgsConstructor
public class CacheDataSource implements EaselDataSource {

    private Cache cache;

    @Override
    public Collection<Course> getUserCourses(User user) {
        return cache.getUserCourses(user);
    }

    @Override
    public Collection<Assignment> getUserAssignments(User user) {
        return cache.getUserAssignments(user);
    }
}
