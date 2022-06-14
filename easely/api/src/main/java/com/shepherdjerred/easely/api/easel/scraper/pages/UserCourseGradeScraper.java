package com.shepherdjerred.easely.api.easel.scraper.pages;

import com.shepherdjerred.easely.api.model.Assignment;
import com.shepherdjerred.easely.api.model.UserCourseGrade;
import lombok.extern.log4j.Log4j2;
import org.jsoup.Connection;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.io.IOException;
import java.util.EnumMap;
import java.util.Map;

@Log4j2
public class UserCourseGradeScraper {

    private static final String BASE_URL = "https://cs.harding.edu/easel";
    private static final String CLASS_GRADES_URL = "/details.php?class_id=";


    public static UserCourseGrade loadCourseGrades(Map<String, String> cookies, String courseId, String userId) {
        log.debug("Loading course grade for the course " + courseId + " and user " + userId);

        try {
            // Load the page with classes
            Connection.Response classGradesUrl = Jsoup.connect(BASE_URL + CLASS_GRADES_URL + courseId + "&sid=" + userId)
                    .cookies(cookies)
                    .method(Connection.Method.GET)
                    .header("Referer", "https://cs.harding.edu/easel/cgi-bin/index")
                    .execute();

            Document document = classGradesUrl.parse();

            Element gradeTable = document.select("#grade-table > tbody").first();
            Elements rows = gradeTable.select("tr");

            Map<Assignment.Type, Double> assignmentWeights = new EnumMap<>(Assignment.Type.class);

            Assignment.Type type = null;
            for (Element row : rows) {
                if (row.child(0).classNames().contains("category")) {
                    String rowText = row.text();
                    type = Assignment.Type.valueOf(rowText.toUpperCase());
                } else if (row.children().size() == 1) {
                    if (!assignmentWeights.containsKey(type)) {
                        String rowText = row.child(0).text();
                        if (rowText.contains("Weight")) {
                            String weightText = row.child(0).child(0).text();
                            String weightTextWithoutPercent = weightText.replace("%", "");
                            double weight = Double.valueOf(weightTextWithoutPercent);
                            assignmentWeights.put(type, weight);
                        } else {
                            assignmentWeights.put(type, 0D);
                        }
                    }
                }
            }

            Element averageElement = document.body().select("body > p:nth-child(4) > b > span").first();
            String averageString = averageElement.text().replace("%", "");
            double average = Double.valueOf(averageString);

            UserCourseGrade userCourseGrade = new UserCourseGrade(
                    assignmentWeights.get(Assignment.Type.HOMEWORK),
                    assignmentWeights.get(Assignment.Type.PROJECT),
                    assignmentWeights.get(Assignment.Type.EXAM),
                    assignmentWeights.get(Assignment.Type.FINAL),
                    average
            );

            return userCourseGrade;

        } catch (IOException e) {
            e.printStackTrace();
        }
        return null;
    }

}
