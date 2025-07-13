use std::net::TcpStream;
use crate::structs::http_request::HttpRequest;
use std::io::{Read, Write};
use std::str::FromStr;
use crate::structs::http_response::HttpResponse;
use std::collections::HashMap;
use std::fs;
use crate::structs::http_status_line::HttpStatusLine;
use crate::structs::http_protocol_version::HttpProtocolVersion;
use std::path::Path;
use crate::structs::http_method::HttpMethod;

const BYTES_PER_KILOBYTE: usize = 1024;
const MAX_KILOBYTES_PER_REQUEST: usize = 128;
const MAX_BYTES_PER_REQUEST: usize = BYTES_PER_KILOBYTE * MAX_KILOBYTES_PER_REQUEST;
const PAGE_PATH: &str = "./pages";

fn empty_headers() -> HashMap<String, String> {
    HashMap::new()
}

pub fn handle_connection(stream: TcpStream) {
    let request = get_http_request(&stream);
    let response = create_http_response(request);
    send_response(response, &stream);
}

fn get_http_request(mut stream: &TcpStream) -> HttpRequest {
    let mut buffer = [0; MAX_BYTES_PER_REQUEST];
    stream.read(&mut buffer).unwrap();

    let request_string = String::from_utf8_lossy(&buffer[..]).as_ref().to_string();
    let end_of_request_index = request_string.rfind("\r\n\r\n").unwrap();
    let request_string = request_string[..end_of_request_index].to_string();

    HttpRequest::from_str(request_string.as_str()).unwrap()
}

fn create_http_response(mut request: HttpRequest) -> HttpResponse {
    if request.start_line.protocol_version != HttpProtocolVersion::OnePointOne {
        return handle_error("400".to_string(), "UNSUPPORTED HTTP PROTOCOL VERSION".to_string())
    }
    if request.start_line.http_method != HttpMethod::GET {
        return handle_error("405".to_string(), "METHOD NOT ALLOWED".to_string())
    }
    let mut request_target = request.start_line.request_target;
    if request_target == "/" {
        request_target = "/index.html".to_string();
    }
    request.start_line.request_target = request_target;
    let file_path = format!("{}/{}", PAGE_PATH, request.start_line.request_target);
    println!("{}", file_path);
    let does_file_exist = Path::new(&file_path).exists();
    if does_file_exist {
        handle_ok(file_path)
    } else {
        handle_error("404".to_string(), "NOT FOUND".to_string())
    }
}

fn handle_ok(file_path: String) -> HttpResponse {
    let body = fs::read_to_string(file_path).unwrap();
    HttpResponse {
        status_line: HttpStatusLine {
            protocol_version: HttpProtocolVersion::OnePointOne,
            status_code: "200".to_string(),
            status_text: "OK".to_string(),
        },
        headers: empty_headers(),
        body,
    }
}

fn handle_error(status_code: String, status_text: String) -> HttpResponse {
    let body = fs::read_to_string(format!("{}/error.html", PAGE_PATH)).unwrap_or("Error loading error page".to_string());
    HttpResponse {
        status_line: HttpStatusLine {
            protocol_version: HttpProtocolVersion::OnePointOne,
            status_code,
            status_text,
        },
        headers: empty_headers(),
        body,
    }
}

fn send_response(_response: HttpResponse, mut stream: &TcpStream) {
    stream.write(_response.to_string().as_bytes()).unwrap();
    stream.flush().unwrap();
}
