package bobby.tables.rsi;

import bobby.tables.rsi.util.template.ThymeleafTemplateEngine;
import com.sun.media.jfxmedia.logging.Logger;
import spark.ModelAndView;
import spark.utils.IOUtils;

import javax.servlet.MultipartConfigElement;
import java.io.*;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static spark.Spark.get;

import static spark.Spark.*;

public class Main {

    public static void main(String[] args) {
        port(8080);
        staticFiles.location("/assets");

        get("/", (request, response) -> {
            Map<String, String> model = new HashMap<>();
            return new ModelAndView(model, "index");
        }, new ThymeleafTemplateEngine());

        get("/company", (request, response) -> {
            Map<String, String> model = new HashMap<>();
            return new ModelAndView(model, "company");
        }, new ThymeleafTemplateEngine());

        get("/management", (request, response) -> {
            Map<String, String> model = new HashMap<>();
            return new ModelAndView(model, "management");
        }, new ThymeleafTemplateEngine());

        get("/employment", (request, response) -> {
            Map<String, String> model = new HashMap<>();
            return new ModelAndView(model, "employment");
        }, new ThymeleafTemplateEngine());

        post("/resumeUpload", (request, response) -> {
            request.attribute("org.eclipse.jetty.multipartConfig", new MultipartConfigElement("/temp"));
            try (InputStream is = request.raw().getPart("uploaded_file").getInputStream()) {
                File file = new File("resumes/" + "resume_" + UUID.randomUUID().toString() + ".pdf");
                OutputStream outputStream = new FileOutputStream(file);
                IOUtils.copy(is, outputStream);
                outputStream.close();
                return "Resume uploaded";
            }
        });

        get("/contact", (request, response) -> {
            Map<String, String> model = new HashMap<>();
            return new ModelAndView(model, "contact");
        }, new ThymeleafTemplateEngine());

        post("/contact", (request, response) -> {

            try (PrintWriter out = new PrintWriter("contact/" + UUID.randomUUID() + ".txt")) {
                out.println(request.body().replace("&", "\n\n").replace("=", " = "));
            }
            return "Message sent";
        });

    }
}