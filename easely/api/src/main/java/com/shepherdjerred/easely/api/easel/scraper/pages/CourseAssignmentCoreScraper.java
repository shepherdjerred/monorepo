package com.shepherdjerred.easely.api.easel.scraper.pages;

import com.shepherdjerred.easely.api.easel.scraper.model.AssignmentCore;
import com.shepherdjerred.easely.api.model.Assignment;
import com.shepherdjerred.easely.api.model.Course;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;
import org.jsoup.Connection;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

import java.io.IOException;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Map;

@AllArgsConstructor
@Log4j2
public class CourseAssignmentCoreScraper {

    private static final String BASE_URL = "https://cs.harding.edu/easel";
    private static final DateTimeFormatter dateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    public static Collection<AssignmentCore> getAssignmentsForCourse(Map<String, String> cookies, Course course) {
        log.debug("Loading assignments for the course " + course.getId());

        Collection<AssignmentCore> assignments = new ArrayList<>();

        for (Assignment.Type type : Assignment.Type.values()) {
            Collection<AssignmentCore> assignmentsOfType = getAssignmentsOfTypeForCourse(cookies, course, type);
            assignments.addAll(assignmentsOfType);
        }

        return assignments;
    }

    private static Collection<AssignmentCore> getAssignmentsOfTypeForCourse(Map<String,String> cookies, Course course, Assignment.Type type) {
        Collection<AssignmentCore> assignments = new ArrayList<>();

        try {
            String typeString = type.toString().toLowerCase();
            Connection.Response assignmentListPage = Jsoup.connect(BASE_URL + "/cgi-bin/view?class_id=" + course.getId() + "&type=" + typeString)
                    .cookies(cookies)
                    .method(Connection.Method.GET)
                    .execute();

            Document document = assignmentListPage.parse();

            Element assignmentListElement = document.select("body > table.box > tbody > tr:nth-child(2) > td > ul").first();

            // Check that there are assignments
            if (assignmentListElement != null) {

                // Parse assignments
                for (Element assignmentElement : assignmentListElement.children()) {

                    // Example text: (2017-01-30) Homework #1 - My Assignment
                    String assignmentElementText = assignmentElement.child(0).text();

                    String assignmentId;
                    int assignmentNumber;
                    String assignmentName;
                    LocalDate assignmentDueDate;

                    // Gets the ID of an assignment from its link
                    // Example link: https://cs.harding.edu/easel/cgi-bin/view?id=12345
                    String assignmentLink = assignmentElement.child(0).attr("href");
                    int lastEqualsIndex = assignmentLink.lastIndexOf("=") + 1;
                    assignmentId = assignmentLink.substring(lastEqualsIndex);

                    // Gets the due date of an assignment from the assignment text
                    String assignmentDueDateText = assignmentElementText.substring(1, 11);
                    assignmentDueDate = LocalDate.parse(assignmentDueDateText, dateTimeFormatter);

                    // Get the assignment number
                    int firstHashtag = assignmentElementText.indexOf('#');
                    int endOfNumber;
                    boolean doesAssignmentHasName = assignmentElementText.substring(firstHashtag).contains("-");

                    if (doesAssignmentHasName) {
                        endOfNumber = assignmentElementText.indexOf(' ', firstHashtag);
                    } else {
                        endOfNumber = assignmentElementText.length();
                    }
                    log.debug(assignmentElementText);
                    log.debug(firstHashtag);
                    log.debug(endOfNumber);

                    String assignmentNumberText = assignmentElementText.substring(firstHashtag + 1, endOfNumber);
                    assignmentNumber = Integer.parseInt(assignmentNumberText);

                    if (doesAssignmentHasName) {
                        // Get the assignment name
                        String assignmentStringAfterDate = assignmentElementText.substring(12);
                        int firstDashAfterDate = assignmentStringAfterDate.indexOf("-");
                        assignmentName = assignmentStringAfterDate.substring(firstDashAfterDate + 2);
                    } else {
                        assignmentName = type.toString() + " #" + assignmentNumber;
                    }

                    AssignmentCore assignmentCore = new AssignmentCore(assignmentId, assignmentName, assignmentDueDate, assignmentNumber, type, course);
                    assignments.add(assignmentCore);
                }
            }
        } catch (IOException e) {
            // TODO handle this properly
            // This exception has been thrown when there is only one exam in a class. The server won't return a list of assignments like normal
            // it will instead give you the file attached to the assignment (ie https://www.harding.edu/fmccown/classes/comp445-f17/review%20for%20exam%201%20fall17.pdf)
            // We should still add this assignment somehow
            e.printStackTrace();
        }
        return assignments;
    }

}
