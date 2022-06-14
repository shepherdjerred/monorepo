package com.shepherdjerred.easely.api.easel.scraper.pages;

import lombok.extern.log4j.Log4j2;
import org.jsoup.Connection;
import org.jsoup.Jsoup;

import java.io.IOException;
import java.util.Map;

@Log4j2
public class UserEaselCookieScraper {

    private static final String BASE_URL = "https://cs.harding.edu/easel";
    private static final String LOGIN_URL = BASE_URL + "/cgi-bin/proc_login";

    // TODO check that login was successful
    public static Map<String, String> getCookies(String username, String password) {
        log.debug("Logging into EASEL for " + username);
        try {
            Connection.Response loginResponse = Jsoup.connect(LOGIN_URL)
                    .data("user", username)
                    .data("passwd", password)
                    .method(Connection.Method.POST)
                    .execute();
            return loginResponse.cookies();
        } catch (IOException e) {
            e.printStackTrace();
        }
        return null;
    }
}
