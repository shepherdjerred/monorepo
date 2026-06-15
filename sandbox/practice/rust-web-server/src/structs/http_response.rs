use crate::structs::http_status_line::HttpStatusLine;
use crate::structs::http_headers::{HttpHeaders, headers_to_string};
use crate::structs::http_body::HttpBody;

#[derive(Debug)]
pub struct HttpResponse {
    pub status_line: HttpStatusLine,
    pub headers: HttpHeaders,
    pub body: HttpBody,
}

impl ToString for HttpResponse {
    fn to_string(&self) -> String {
        format!("{}\r\n{}\r\n{}\r\n\r\n", self.status_line.to_string(), headers_to_string(&self.headers), self.body)
    }
}