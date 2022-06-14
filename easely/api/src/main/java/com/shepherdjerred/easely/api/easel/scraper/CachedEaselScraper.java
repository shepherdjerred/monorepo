package com.shepherdjerred.easely.api.easel.scraper;

import com.shepherdjerred.easely.api.easel.scraper.model.*;
import com.shepherdjerred.easely.api.easel.scraper.pages.*;
import com.shepherdjerred.easely.api.model.*;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;
import org.redisson.api.RBucket;
import org.redisson.api.RedissonClient;

import java.sql.Date;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@Log4j2
@AllArgsConstructor
public class CachedEaselScraper implements EaselScraper {

    private RedissonClient redisson;

    private Map<String, String> login(User user) {
        Map<String, String> cookies;
        RBucket<Map<String, String>> cookiesBucket = redisson.getBucket("user:" + user.getUuid() + ":cookies");

        if (cookiesBucket.isExists()) {
            cookies = cookiesBucket.get();
        } else {
            cookies = UserEaselCookieScraper.getCookies(user.getEaselUsername(), user.getEaselPassword());
            cookiesBucket.set(cookies);
            cookiesBucket.expire(1, TimeUnit.HOURS);
        }

        return cookies;
    }

    @Override
    public Collection<Course> scrapeUserCourse(User user) {
        Collection<CourseCore> userCourses;
        Collection<Course> courses = new ArrayList<>();

        RBucket<Collection<CourseCore>> userCoursesBucket = redisson.getBucket("user:" + user.getUuid() + ":courses");

        // Find out what courses a user is in
        // We should only load the CourseCore here
        if (userCoursesBucket.isExists()) {
            userCourses = userCoursesBucket.get();
        } else {
            Map<String, String> cookies = login(user);
            userCourses = UserCourseCoreScraper.getCourses(cookies);
            userCoursesBucket.set(userCourses);
            userCoursesBucket.expire(30, TimeUnit.DAYS);
        }

        // TODO Cache the CourseCore?
        // Why would we do this?
        // CourseCore is loaded when the user requests their courses
        // CourseCore is rarely updated, but we have nothing to lose by updating the cache

        // Load details for the courses
        // Here we get the actual Course object
        for (CourseCore courseCore : userCourses) {
            Course course;

            RBucket<CourseDetails> courseDetailsBucket = redisson.getBucket("course:details:" + courseCore.getId());
            CourseDetails courseDetails;
            if (courseDetailsBucket.isExists()) {
                courseDetails = courseDetailsBucket.get();
            } else {
                Map<String, String> cookies = login(user);
                CourseDetailsScraper courseDetailsScraper = new CourseDetailsScraper();
                courseDetails = courseDetailsScraper.loadCourseDetails(cookies, courseCore.getId());
                courseDetailsBucket.set(courseDetails);
                courseDetailsBucket.expire(7, TimeUnit.DAYS);
            }

            RBucket<UserCourseGrade> courseGradeBucket = redisson.getBucket("user:" + user.getUuid() + ":course:" + courseCore.getId() + ":grade");
            UserCourseGrade courseGrade;
            if (courseGradeBucket.isExists()) {
                courseGrade = courseGradeBucket.get();
            } else {
                Map<String, String> cookies = login(user);

                RBucket<String> easelUserIdBucket = redisson.getBucket("user:" + user.getUuid() + ":id");
                String easelUserId;

                if (easelUserIdBucket.isExists()) {
                    easelUserId = easelUserIdBucket.get();
                } else {
                    easelUserId = UserEaselIdScraper.getUserId(cookies);
                    easelUserIdBucket.set(easelUserId);
                }

                courseGrade = UserCourseGradeScraper.loadCourseGrades(cookies, courseCore.getId(), easelUserId);
                courseGradeBucket.set(courseGrade);
                courseGradeBucket.expire(1, TimeUnit.DAYS);
            }

            course = Course.fromSubObjects(courseCore, courseDetails, courseGrade);
            courses.add(course);
        }

        return courses;
    }

    @Override
    public Collection<Assignment> scrapeUserAssignments(User user) {
        Collection<Assignment> assignments = new ArrayList<>();
        scrapeUserCourse(user).forEach(course -> {
            getAssignments(user, course).forEach(assignment -> {
                assignments.add(assignment);
            });
        });
        return assignments;
    }

    private Collection<Assignment> getAssignments(User user, Course course) {
        Collection<Assignment> assignments = new ArrayList<>();
        Collection<AssignmentCore> courseAssignments;
        RBucket<Collection<AssignmentCore>> courseAssignmentsBucket = redisson.getBucket("course:" + course.getId() + ":assignments");

        // Find Assignments for Course
        if (courseAssignmentsBucket.isExists()) {
            courseAssignments = courseAssignmentsBucket.get();
        } else {
            Map<String, String> cookies = login(user);

            courseAssignments = CourseAssignmentCoreScraper.getAssignmentsForCourse(cookies, course);
            courseAssignmentsBucket.set(courseAssignments);
            courseAssignmentsBucket.expire(1, TimeUnit.DAYS);
        }

        // TODO Cache AssignmentCore?

        // Load details and grade for assignment
        for (AssignmentCore assignmentCore : courseAssignments) {
            RBucket<AssignmentDetails> assignmentDetailsBucket = redisson.getBucket("assignment:details:" + assignmentCore.getId());
            Assignment assignment;
            AssignmentDetails assignmentDetails;
            if (assignmentDetailsBucket.isExists()) {
                assignmentDetails = assignmentDetailsBucket.get();
            } else {
                Map<String, String> cookies = login(user);
                assignmentDetails = AssignmentDetailsScraper.loadAssignmentDetails(cookies, assignmentCore.getId());
                assignmentDetailsBucket.set(assignmentDetails);
                // If the due date hasn't past, let's update the assignment daily
                if (assignmentCore.getDate().isAfter(LocalDate.now())) {
                    assignmentDetailsBucket.expire(1, TimeUnit.DAYS);
                }
            }

            if (assignmentCore.getType() == Assignment.Type.NOTES) {
                assignment = Assignment.fromSubObjects(assignmentCore, assignmentDetails);
            } else {
                RBucket<UserAssignmentGrade> assignmentGradeBucket = redisson.getBucket("user:" + user.getUuid() + ":assignment:" + assignmentCore.getId() + ":grade" );
                UserAssignmentGrade assignmentGrade;
                if (assignmentGradeBucket.isExists()) {
                    assignmentGrade = assignmentGradeBucket.get();
                } else {
                    Map<String, String> cookies = login(user);
                    assignmentGrade = UserAssignmentGradeScraper.loadAssignmentGrade(cookies, assignmentCore.getId());
                    assignmentGradeBucket.set(assignmentGrade);
                    // If the due date hasn't past, let's not update it until it's due
                    if (assignmentCore.getDate().isAfter(LocalDate.now())) {
                        assignmentGradeBucket.expireAt(Date.valueOf(assignmentCore.getDate()));
                    } else {
                        // If the assigment isn't graded, let's refresh it in a day
                        if (assignmentGrade.isGraded()) {
                            assignmentGradeBucket.expire(1, TimeUnit.DAYS);
                        }
                    }

                }
                assignment = GradedAssignment.fromSubObjects(assignmentCore, assignmentDetails, assignmentGrade);
            }

            assignments.add(assignment);
        }

        return assignments;
    }
}
