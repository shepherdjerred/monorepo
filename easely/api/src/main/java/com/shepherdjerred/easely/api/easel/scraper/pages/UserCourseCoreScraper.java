package com.shepherdjerred.easely.api.easel.scraper.pages;

import com.shepherdjerred.easely.api.easel.scraper.model.CourseCore;
import lombok.extern.log4j.Log4j2;
import org.jsoup.Connection;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Map;

@Log4j2
public class UserCourseCoreScraper {

    private static final String BASE_URL = "https://cs.harding.edu/easel";
    private static final String CLASS_LIST_URL = BASE_URL + "/cgi-bin/user";

    public static Collection<CourseCore> getCourses(Map<String, String> cookies) {
        log.debug("Loading courses for user");

        Collection<CourseCore> courses = new ArrayList<>();

        try {
            // Load the page with classes
            Connection.Response homePage = Jsoup.connect(CLASS_LIST_URL)
                    .cookies(cookies)
                    .method(Connection.Method.GET)
                    .execute();

            Document document = homePage.parse();

            Element classList = document.select("body > div > table:nth-child(2) > tbody > tr:nth-child(2) > td > ul").first();

            // Parse courses
            for (Element easelClass : classList.children()) {

                String classString = easelClass.child(0).text();

                String courseId;
                String courseCode;
                String courseName;

                // Get the course ID
                String link = easelClass.child(0).attr("href");
                int lastEqualsIndex = link.lastIndexOf("=");
                courseId = link.substring(lastEqualsIndex + 1);

                // Get the course name and code
                int lastDashIndex = classString.lastIndexOf("–");
                courseCode = classString.substring(0, lastDashIndex - 1).toUpperCase();
                courseName = classString.substring(lastDashIndex + 2);

                CourseCore course = new CourseCore(courseId, courseName, courseCode);
                courses.add(course);
            }

        } catch (IOException e) {
            e.printStackTrace();
        }

        return courses;
    }

}
