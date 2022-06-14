package com.shepherdjerred.easely.api.model;

import com.shepherdjerred.easely.api.easel.scraper.model.CourseCore;
import com.shepherdjerred.easely.api.easel.scraper.model.CourseDetails;
import lombok.*;

import java.util.Map;

@NoArgsConstructor
@AllArgsConstructor
@ToString
public class Course {
    @Getter
    private String id;
    @Getter
    private String name;
    @Getter
    private String code;
    @Getter
    private String teacher;
    @Getter
    private Map<String, String> resources;
    @Getter
    private UserCourseGrade userCourseGrade;

    public static Course fromSubObjects(CourseCore courseCore, CourseDetails courseDetails, UserCourseGrade userCourseGrade) {
        return new Course(courseCore.getId(),
                courseCore.getName(),
                courseCore.getCode(),
                courseDetails.getTeacher(),
                courseDetails.getResources(),
                userCourseGrade);
    }
}
