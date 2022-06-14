package com.shepherdjerred.easely.api.easel.scraper.pages;

import com.shepherdjerred.easely.api.easel.scraper.model.AssignmentDetails;
import lombok.extern.log4j.Log4j2;
import org.jsoup.Connection;
import org.jsoup.Jsoup;
import org.jsoup.UnsupportedMimeTypeException;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.io.IOException;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.Map;

@Log4j2
public class AssignmentDetailsScraper {

    private static final String BASE_URL = "https://cs.harding.edu/easel";
    private static final String ASSIGNMENT_DETAILS_URL = "/cgi-bin/view?id=";
    private static final String ASSIGNMENT_INFO_URL = "/cgi-bin/info?id=";
    private static final DateTimeFormatter dateTimeFormatter = DateTimeFormatter.ofPattern("hh:mma");

    public static AssignmentDetails loadAssignmentDetails(Map<String, String> cookies, String assignmentId) {
        log.debug("Loading assignment details for " + assignmentId);
        try {
            Connection.Response assignmentInfoUrl = Jsoup.connect(BASE_URL + ASSIGNMENT_INFO_URL + assignmentId)
                    .cookies(cookies)
                    .method(Connection.Method.GET)
                    .execute();

            Document document = assignmentInfoUrl.parse();

            Element dateElement = document.body().select("#date").first();

            String dateElementText = dateElement.text();
            int colonIndex = dateElementText.indexOf(":");

            String timeString = dateElementText.substring(colonIndex - 2);
            timeString = timeString.replace(" ", "0").toUpperCase();

            LocalTime dueTime = LocalTime.parse(timeString, dateTimeFormatter);
            String attachmentUrl;

            try {
                Connection.Response assignmentDetailsUrl = Jsoup.connect(BASE_URL + ASSIGNMENT_DETAILS_URL + assignmentId)
                        .cookies(cookies)
                        .method(Connection.Method.GET)
                        .execute();

                document = assignmentDetailsUrl.parse();

                Elements embedElement = document.select("html > frameset > frame:nth-child(2)");
                attachmentUrl = embedElement.attr("src");
            } catch (UnsupportedMimeTypeException e) {
                attachmentUrl = e.getUrl();
                System.out.println("MIME ERROR");
            } catch (IOException e) {
                // Too many redirects?
                // TODO
                e.printStackTrace();
                attachmentUrl = null;
            }

            return new AssignmentDetails(dueTime, attachmentUrl);

        } catch (IOException e) {
            e.printStackTrace();
        }
        return null;
    }

}
