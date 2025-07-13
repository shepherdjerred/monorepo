package main

import (
	"errors"
	"fmt"
	"html/template"
	"io/ioutil"
	"log"
	"net/http"
	"regexp"
)

var templateNames = []string{
	"html/edit.html",
	"html/view.html",
	"html/error.html",
}

var templates = template.Must(template.ParseFiles(templateNames...))
var validPath = regexp.MustCompile("^/(edit|save|view)/([a-zA-Z0-9]+)$")

type Page struct {
	Title string
	Body  []byte
}

func (page *Page) save() error {
	fileName := getPageFilePath(page.Title)
	return ioutil.WriteFile(fileName, page.Body, 0600)
}

func getPageFilePath(title string) string {
	return "pages/" + title + ".txt"
}

func loadPage(title string) (*Page, error) {
	fileName := getPageFilePath(title)
	body, err := ioutil.ReadFile(fileName)
	if err == nil {
		return &Page{Title: title, Body: body}, nil
	} else {
		return nil, err
	}
}

func (page Page) String() string {
	return fmt.Sprintf("Title: %s\n%s", page.Title, page.Body)
}

func viewHandler(writer http.ResponseWriter, request *http.Request) {
	page, err := loadPageFromRequest(request)
	if err == nil {
		renderTemplateOrError(writer, "view", page)
	} else {
		title, err := getPageTitleOrRedirect(writer, request)
		if err != nil {
			return
		}
		http.Redirect(writer, request, "/edit/"+title, http.StatusFound)
	}
}

func saveHandler(writer http.ResponseWriter, request *http.Request) {
	title, err := getPageTitleOrRedirect(writer, request)
	if err != nil {
		return
	}
	body := request.FormValue("body")
	page := Page{title, []byte(body)}
	err = page.save()
	if err == nil {
		http.Redirect(writer, request, "/view/"+title, http.StatusFound)
	} else {
		redirectToErrorPage(writer, request)
	}
}

func editHandler(writer http.ResponseWriter, request *http.Request) {
	page, err := loadPageFromRequestOrCreateBlankPage(request)
	if err == nil {
		renderTemplateOrError(writer, "edit", page)
	} else {
		renderError(writer, err)
	}
}

func renderTemplate(writer http.ResponseWriter, templateName string, data interface{}) error {
	err := templates.ExecuteTemplate(writer, templateName+".html", data)
	return err
}

func renderTemplateOrError(writer http.ResponseWriter, templateName string, data interface{}) {
	err := renderTemplate(writer, templateName, data)
	if err != nil {
		renderError(writer, err)
	}
}

func renderError(writer http.ResponseWriter, data interface{}) {
	err := renderTemplate(writer, "error", data)
	if err != nil {
		_, writerErr := writer.Write([]byte("An error occurred when displaying the error page."))
		if writerErr != nil {
			log.Fatal(writerErr)
		}
	}
}

func redirectToErrorPage(writer http.ResponseWriter, request *http.Request) {
	http.Redirect(writer, request, "/error", http.StatusInternalServerError)
}

func loadPageFromRequestOrCreateBlankPage(request *http.Request) (*Page, error) {
	if page, err := loadPageFromRequest(request); err == nil {
		return page, err
	} else {
		title, err := getPageTitle(request)
		if err != nil {
			return nil, err
		}
		blankPage := createBlankPage(title)
		return &blankPage, nil
	}
}

func createBlankPage(title string) Page {
	return Page{Title: title, Body: []byte("")}
}

func loadPageFromRequest(request *http.Request) (*Page, error) {
	title, err := getPageTitle(request)
	if err == nil {
		return loadPage(title)
	} else {
		return nil, err
	}
}

func getPageTitleOrRedirect(writer http.ResponseWriter, request *http.Request) (string, error) {
	if title, err := getPageTitle(request); err == nil {
		return title, nil
	} else {
		renderError(writer, err)
		return "", nil
	}
}

func getPageTitle(request *http.Request) (string, error) {
	m := validPath.FindStringSubmatch(request.URL.Path)
	if m == nil {
		return "", errors.New("invalid URL")
	}
	title := m[2]
	log.Println(title)
	return title, nil
}

func errorHandler(writer http.ResponseWriter, _ *http.Request) {
	renderError(writer, "Unknown.")
}

func main() {
	http.HandleFunc("/error", errorHandler)
	http.HandleFunc("/view/", viewHandler)
	http.HandleFunc("/save/", saveHandler)
	http.HandleFunc("/edit/", editHandler)
	log.Fatal(http.ListenAndServe("127.0.0.1:8080", nil))
}
