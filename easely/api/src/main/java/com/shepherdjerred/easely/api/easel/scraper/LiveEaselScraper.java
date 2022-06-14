package com.shepherdjerred.easely.api.easel.scraper;

import com.shepherdjerred.easely.api.easel.scraper.model.*;
import com.shepherdjerred.easely.api.easel.scraper.pages.*;
import com.shepherdjerred.easely.api.model.*;
import lombok.extern.log4j.Log4j2;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Map;

@Log4j2
public class LiveEaselScraper implements EaselScraper {

    private Map<String, String> scrapeUserEaselCookies(User user) {
        return UserEaselCookieScraper.getCookies(user.getEaselUsername(), user.getEaselPassword());
    }

    private String scrapeUserEaselId(User user) {
        Map<String, String> cookies = scrapeUserEaselCookies(user);
        return UserEaselIdScraper.getUserId(cookies);
    }

    @Override
    public Collection<Course> scrapeUserCourse(User user) {
        Collection<Course> courses = new ArrayList<>();

        Map<String, String> cookies = scrapeUserEaselCookies(user);
        String userEaselId = scrapeUserEaselId(user);

        Collection<CourseCore> courseCores = UserCourseCoreScraper.getCourses(cookies);

        courseCores.forEach(courseCore -> {
            CourseDetails courseDetails = CourseDetailsScraper.loadCourseDetails(cookies, courseCore.getId());
            UserCourseGrade userCourseGrade = UserCourseGradeScraper.loadCourseGrades(cookies, courseCore.getId(), userEaselId);
            Course course = Course.fromSubObjects(courseCore, courseDetails, userCourseGrade);
            courses.add(course);
        });

        return courses;
    }

    @Override
    public Collection<Assignment> scrapeUserAssignments(User user) {
        Collection<Assignment> assignments = new ArrayList<>();

        Map<String, String> cookies = scrapeUserEaselCookies(user);
        Collection<Course> courses = scrapeUserCourse(user);

        courses.forEach(course -> {
            Collection<AssignmentCore> assignmentCores = CourseAssignmentCoreScraper.getAssignmentsForCourse(cookies, course);
            assignmentCores.forEach(assignmentCore -> {
                AssignmentDetails assignmentDetails = AssignmentDetailsScraper.loadAssignmentDetails(cookies, assignmentCore.getId());

                Assignment assignment;
                if (assignmentCore.getType() == Assignment.Type.NOTES) {
                    assignment = Assignment.fromSubObjects(assignmentCore, assignmentDetails);
                } else {
                    UserAssignmentGrade gradedAssignment = UserAssignmentGradeScraper.loadAssignmentGrade(cookies, assignmentCore.getId());
                    assignment = GradedAssignment.fromSubObjects(assignmentCore, assignmentDetails, gradedAssignment);
                }
                assignments.add(assignment);
            });
        });

        return assignments;
    }
}
