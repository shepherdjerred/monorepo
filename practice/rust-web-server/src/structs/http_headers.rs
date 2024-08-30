use std::collections::HashMap;

pub type HttpHeaders = HashMap<String, String>;

pub fn headers_to_map(headers: String) -> HashMap<String, String> {
    let mut map = HashMap::new();

    for header_entry in headers.split("\n") {
        let mut parts = header_entry.split(" ");
        map.insert(parts.next().unwrap().to_string(), parts.next().unwrap().to_string());
    }

    return map;
}

pub fn headers_to_string(headers: &HttpHeaders) -> String {
    headers.iter().map(|header| {
        format!("{}: {}\r\n", header.0, header.1)
    }).collect()
}
