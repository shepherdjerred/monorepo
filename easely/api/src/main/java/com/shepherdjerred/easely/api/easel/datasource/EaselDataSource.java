package com.shepherdjerred.easely.api.easel.datasource;

import com.shepherdjerred.easely.api.model.Assignment;
import com.shepherdjerred.easely.api.model.Course;
import com.shepherdjerred.easely.api.model.User;

import java.util.Collection;

public interface EaselDataSource {
    Collection<Course> getUserCourses(User user);

    Collection<Assignment> getUserAssignments(User user);
}
