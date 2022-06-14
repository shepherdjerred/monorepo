package com.shepherdjerred.easely.api.easel.cache;

import com.shepherdjerred.easely.api.model.Assignment;
import com.shepherdjerred.easely.api.model.Course;
import com.shepherdjerred.easely.api.model.User;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;
import org.redisson.api.RBucket;
import org.redisson.api.RedissonClient;

import java.util.Collection;
import java.util.concurrent.TimeUnit;

@Log4j2
@AllArgsConstructor
public class RedissonCache implements Cache {

    private RedissonClient redisson;
    private Loader loader;

    @Override
    public Collection<Course> getUserCourses(User user) {

        Collection<Course> userCourses;

        if (hasUserCourses(user)) {
            userCourses = getUserCoursesFromCache(user);
        } else {
            RBucket<Collection<Course>> userCoursesBucket = redisson.getBucket("user:" + user.getUuid() + ":courses:full");
            userCourses = loader.getUserCourses(user);
            userCoursesBucket.set(userCourses);
            userCoursesBucket.expire(1, TimeUnit.DAYS);
        }

        return userCourses;
    }

    @Override
    public Collection<Assignment> getUserAssignments(User user) {

        Collection<Assignment> userAssignments;

        if (hasUserAssignments(user)) {
            userAssignments = getUserAssignmentsFromCache(user);
        } else {
            RBucket<Collection<Assignment>> userAssignmentsBucket = redisson.getBucket("user:" + user.getUuid() + ":assignments:full");
            userAssignments = loader.getUserAssignments(user);
            userAssignmentsBucket.set(userAssignments);
            userAssignmentsBucket.expire(1, TimeUnit.DAYS);        }

        return userAssignments;
    }

    private boolean hasUserCourses(User user) {
        RBucket<Collection<Course>> userCoursesBucket = redisson.getBucket("user:" + user.getUuid() + ":courses:full");
        return userCoursesBucket.isExists();
    }

    private boolean hasUserAssignments(User user) {
        RBucket<Collection<Assignment>> userAssignmentsBucket = redisson.getBucket("user:" + user.getUuid() + ":assignments:full");
        return userAssignmentsBucket.isExists();
    }

    private Collection<Course> getUserCoursesFromCache(User user) {
        RBucket<Collection<Course>> userCoursesBucket = redisson.getBucket("user:" + user.getUuid() + ":courses:full");
        return userCoursesBucket.get();
    }

    private Collection<Assignment> getUserAssignmentsFromCache(User user) {
        RBucket<Collection<Assignment>> userAssignmentsBucket = redisson.getBucket("user:" + user.getUuid() + ":assignments:full");
        return userAssignmentsBucket.get();
    }
}
