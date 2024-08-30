use crate::structs::http_start_line::HttpStartLine;
use crate::structs::http_headers::{HttpHeaders, headers_to_map};
use std::str::FromStr;
use crate::structs::http_body::HttpBody;
use crate::structs::http_method::HttpMethod;

#[derive(Debug)]
pub struct HttpRequest {
    pub start_line: HttpStartLine,
    pub headers: HttpHeaders,
    pub body: HttpBody,
}

impl FromStr for HttpRequest {
    type Err = String;

    // TODO: Refactor
    /// HTTP request/response format: https://developer.mozilla.org/en-US/docs/Web/HTTP/Messages
    /// All line endings are \r\n.
    /// First line is the start line.
    /// Lines between the first line and an blank line (\r\n) are the headers.
    /// Lines between the end of the headers and two blank lines (\r\n\r\n) are the body.
    fn from_str(request_string: &str) -> Result<Self, String> {
        let mut parts = request_string.split("\r\n");
        let start_line = HttpStartLine::from_str(parts.next().unwrap()).unwrap();

        let headers: Vec<&str> = request_string.split("^\r\n").next().unwrap().split("\r\n").skip(1).collect();
        let headers = headers.join("\r\n");
        let headers = headers_to_map(headers);

        let body = request_string.split("^\r\n").skip(1).next().unwrap_or("").to_string();

        if start_line.http_method == HttpMethod::GET && body != "" {
            return Err("GET requests cannot have a body".to_string());
        }

        Ok(HttpRequest {
            start_line,
            headers,
            body,
        })
    }
}
