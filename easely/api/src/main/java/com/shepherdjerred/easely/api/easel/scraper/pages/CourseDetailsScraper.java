package com.shepherdjerred.easely.api.easel.scraper.pages;

import com.shepherdjerred.easely.api.easel.scraper.model.CourseDetails;
import lombok.extern.log4j.Log4j2;
import org.jsoup.Connection;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

@Log4j2
public class CourseDetailsScraper {

    private static final String BASE_URL = "https://cs.harding.edu/easel";
    private static final String CLASS_DETAILS_URL = "/cgi-bin/class?id=";

    public static CourseDetails loadCourseDetails(Map<String, String> cookies, String courseId) {
        log.debug("Loading course details for " + courseId);
        try {
            // Load the page with classes
            Connection.Response classDetailsUrl = Jsoup.connect(BASE_URL + CLASS_DETAILS_URL + courseId)
                    .cookies(cookies)
                    .method(Connection.Method.GET)
                    .execute();

            Document document = classDetailsUrl.parse();

            Element teacherElement = document.body().select("body > div > table.box.classInfo > tbody > tr:nth-child(2) > td > dl > dd:nth-child(12)").first();
            String teacher = teacherElement.text();

            Element resourcesElement = document.body().select("body > div > table.classResources.box > tbody > tr:nth-child(2) > td > ul").first();

            Map<String, String> resources = new HashMap<>();
            // Not all classes have resources, check for null first
            if (resourcesElement != null) {
                resourcesElement.children().forEach(element -> {
                    String title = element.child(0).text();
                    String url = element.child(0).attr("href");
                    resources.put(title, url);
                });
            }

            return new CourseDetails(teacher, resources);

        } catch (IOException e) {
            e.printStackTrace();
        }
        return null;
    }

}
