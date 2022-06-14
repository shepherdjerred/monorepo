package com.shepherdjerred.easely.api.http.router.filters;

import com.shepherdjerred.easely.api.config.EaselyConfig;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;
import spark.Filter;
import spark.Request;
import spark.Response;

@Log4j2
@AllArgsConstructor
public class CorsFilter implements Filter {

    private EaselyConfig easelyConfig;

    @Override
    public void handle(Request request, Response response) {
        log.debug("Allowing CORS");
    }
}
