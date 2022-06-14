package com.shepherdjerred.easely.api.easel.scraper.pages;

import com.shepherdjerred.easely.api.model.AssignmentSubmission;
import com.shepherdjerred.easely.api.easel.scraper.model.UserAssignmentGrade;
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
public class UserAssignmentGradeScraper {

    private static final String BASE_URL = "https://cs.harding.edu/easel";
    private static final String ASSIGNMENT_INFO_URL = "/cgi-bin/info?id=";
    private static final String ASSIGNMENT_SUBMIT_URL = "/cgi-bin/submit?id=";

    public static UserAssignmentGrade loadAssignmentGrade(Map<String, String> cookies, String assignmentId) {
        log.debug("Loading assignment grade for " + assignmentId);
        try {
            // Load the page with classes
            Connection.Response classInfoUrl = Jsoup.connect(BASE_URL + ASSIGNMENT_INFO_URL + assignmentId)
                    .cookies(cookies)
                    .method(Connection.Method.GET)
                    .execute();

            Document document = classInfoUrl.parse();

            Element totalPointsElement = document.select("#points").first();
            if (totalPointsElement != null) {
                String totalPointsText = totalPointsElement.text().replace(" Points", "");
                int possiblePoints = Integer.parseInt(totalPointsText);

                log.debug("LOADING GRADES FOR " + assignmentId);

                Connection.Response classGradesUrl = Jsoup.connect(BASE_URL + ASSIGNMENT_SUBMIT_URL + assignmentId)
                        .cookies(cookies)
                        .method(Connection.Method.GET)
                        .execute();

                document = classGradesUrl.parse();

                Element earnedPointsElement = document.select("body > div:nth-child(1)").first();

                Collection<AssignmentSubmission> assignmentSubmissions = new ArrayList<>();

                Element noFilesElement = document.select("body > h1").first();

                // TODO go through submissions table
                if (noFilesElement == null) {

                }

                int earnedPoints;
                boolean isGraded;
                if (earnedPointsElement != null) {
                    String earnedPointsText = earnedPointsElement.text().replace("Grade: ", "");
                    // TODO handle better
                    if (earnedPointsText.equals("Submissions for this assignment are no longer being accepted")) {
                        log.warn("Assignment grade not fetched");
                        return new UserAssignmentGrade(0, 0, false, assignmentSubmissions);
                    }
                    earnedPoints = Integer.parseInt(earnedPointsText.replaceAll("\\u00a0", "").replaceAll(" ", ""));
                    isGraded = true;
                } else {
                    earnedPoints = 0;
                    isGraded = false;
                }

                return new UserAssignmentGrade(possiblePoints, earnedPoints, isGraded, assignmentSubmissions);

            } else {
                // TODO handle better
                return new UserAssignmentGrade(0, 0, false, null);
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
        return null;
    }

}
