package com.shepherdjerred.easely.api.easel.scraper.pages;

import lombok.extern.log4j.Log4j2;
import org.jsoup.Connection;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

import java.io.IOException;
import java.util.Map;

@Log4j2
public class UserEaselIdScraper {

    private static final String BASE_URL = "https://cs.harding.edu/easel";
    private static final String CLASS_LIST_URL = BASE_URL + "/cgi-bin/user";

    public static String getUserId(Map<String, String> cookies) {
        log.debug("Loading user EASEL ID");

        try {
            // Load the page with classes
            Connection.Response homePage = Jsoup.connect(CLASS_LIST_URL)
                    .cookies(cookies)
                    .method(Connection.Method.GET)
                    .execute();

            Document document = homePage.parse();

            Element classList = document.select("body > div > table:nth-child(2) > tbody > tr:nth-child(2) > td > ul").first();

            // Parse courses
            if (classList.children().size() > 0) {
                Element firstChild = classList.child(0);
                Element gradeLinkElement = firstChild.child(1);
                String linkText = gradeLinkElement.attr("href");
                int sidIndex = linkText.lastIndexOf('=');
                String userId = linkText.substring(sidIndex + 1);
                log.debug(userId);
                return userId;
            }

        } catch (IOException e) {
            e.printStackTrace();
        }

        return null;
    }

}
