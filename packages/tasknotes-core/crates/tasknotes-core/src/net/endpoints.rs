//! Every `/v2` path the client uses, and the one escaping rule they share.
//!
//! Paths live here rather than inline at their call sites so the whole URL
//! surface of the app is one screen long and so the escaping cannot be applied
//! in one place and forgotten in another.

use crate::domain::TaskId;

/// The collection endpoint.
pub const TASKS: &str = "/api/tasks";

/// The aggregate time-report endpoint.
pub const TIME_SUMMARY: &str = "/api/time/summary";

/// Start a server-backed pomodoro interval.
pub const POMODORO_START: &str = "/api/pomodoro/start";

/// Stop the current server-backed pomodoro interval.
pub const POMODORO_STOP: &str = "/api/pomodoro/stop";

/// Toggle the current server-backed pomodoro between running and paused.
pub const POMODORO_PAUSE: &str = "/api/pomodoro/pause";

/// Read the current server-backed pomodoro interval.
pub const POMODORO_STATUS: &str = "/api/pomodoro/status";

/// The largest page the `/v2` list endpoint will answer with.
///
/// The server caps `limit` here, so asking for more silently gets this and the
/// client would then advance its offset past items it never received.
pub const LIST_PAGE_LIMIT: u32 = 200;

/// The query string for one page of the task list.
#[must_use]
pub fn tasks_page_query(offset: u32) -> String {
    format!("limit={LIST_PAGE_LIMIT}&offset={offset}")
}

/// One task, addressed by its vault path.
#[must_use]
pub fn task(id: &TaskId) -> String {
    format!("{TASKS}/{}", encode_component(id.as_str()))
}

/// One task's recurring-instance completion endpoint.
#[must_use]
pub fn task_complete_instance(id: &TaskId) -> String {
    format!(
        "{TASKS}/{}/complete-instance",
        encode_component(id.as_str())
    )
}

/// Start tracking time against one task.
#[must_use]
pub fn task_time_start(id: &TaskId) -> String {
    format!("{TASKS}/{}/time/start", encode_component(id.as_str()))
}

/// Stop tracking time against one task.
#[must_use]
pub fn task_time_stop(id: &TaskId) -> String {
    format!("{TASKS}/{}/time/stop", encode_component(id.as_str()))
}

/// Read tracked-time totals for one task.
#[must_use]
pub fn task_time(id: &TaskId) -> String {
    format!("{TASKS}/{}/time", encode_component(id.as_str()))
}

/// Build the aggregate time-report query.
#[must_use]
pub fn time_summary(period: &str) -> String {
    format!("{TIME_SUMMARY}?period={}", encode_component(period))
}

/// Percent-encode a value for use as **one** URL path component.
///
/// Byte-for-byte `encodeURIComponent`, which is what the reference TypeScript
/// client uses: everything outside `A-Z a-z 0-9 - _ . ! ~ * ' ( )` becomes
/// `%XX` over the value's UTF-8 bytes, uppercase.
///
/// A task id is a vault path — `Tasks/Write the plan.md` — so it carries both
/// slashes and spaces, and the slash is the whole point. Foundation's
/// `CharacterSet.urlPathAllowed` deliberately permits `/`, which is correct for
/// a path and wrong for a single component of one; that mistake was found by a
/// test in the Swift shell and every other shell would have rediscovered it.
/// Owning the escaping here is what makes that impossible.
#[must_use]
pub fn encode_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if is_unreserved(byte) {
            encoded.push(char::from(byte));
        } else {
            encoded.push('%');
            encoded.push(hex_upper(byte >> 4));
            encoded.push(hex_upper(byte));
        }
    }
    encoded
}

/// Whether a byte is one `encodeURIComponent` leaves alone.
const fn is_unreserved(byte: u8) -> bool {
    byte.is_ascii_alphanumeric()
        || matches!(
            byte,
            b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
        )
}

/// The uppercase hex digit for a byte's low nibble.
///
/// A `match` rather than a lookup table because indexing is denied in this
/// workspace, and rather than `format!` because appending a formatted string to
/// a string in a loop is too. The mask makes the arms exhaustive over the
/// values that can reach them, so the last arm is `15` and not a fallback.
const fn hex_upper(byte: u8) -> char {
    match byte & 0x0f {
        0 => '0',
        1 => '1',
        2 => '2',
        3 => '3',
        4 => '4',
        5 => '5',
        6 => '6',
        7 => '7',
        8 => '8',
        9 => '9',
        10 => 'A',
        11 => 'B',
        12 => 'C',
        13 => 'D',
        14 => 'E',
        _ => 'F',
    }
}

#[cfg(test)]
mod tests {
    use super::{
        LIST_PAGE_LIMIT, TASKS, encode_component, task, task_complete_instance, task_time,
        task_time_start, task_time_stop, tasks_page_query, time_summary,
    };
    use crate::domain::TaskId;

    fn id(raw: &str) -> TaskId {
        TaskId::parse(raw).unwrap()
    }

    #[test]
    fn a_task_id_is_one_component_so_its_slashes_are_escaped() {
        // The bug this function exists to prevent: `urlPathAllowed` keeps `/`,
        // which turns one task into three path segments and a 404.
        assert_eq!(
            task(&id("Tasks/Write the plan.md")),
            "/api/tasks/Tasks%2FWrite%20the%20plan.md"
        );
        assert_eq!(
            task_complete_instance(&id("Tasks/a.md")),
            "/api/tasks/Tasks%2Fa.md/complete-instance"
        );
        assert_eq!(
            task_time_start(&id("Tasks/a.md")),
            "/api/tasks/Tasks%2Fa.md/time/start"
        );
        assert_eq!(
            task_time_stop(&id("Tasks/a.md")),
            "/api/tasks/Tasks%2Fa.md/time/stop"
        );
        assert_eq!(task_time(&id("Tasks/a.md")), "/api/tasks/Tasks%2Fa.md/time");
        assert_eq!(
            time_summary("this week"),
            "/api/time/summary?period=this%20week"
        );
    }

    #[test]
    fn matches_encode_uri_component_on_every_reserved_character() {
        // The exact set `encodeURIComponent` leaves alone, and a sample of what
        // it does not. Uppercase hex, UTF-8 bytes.
        assert_eq!(
            encode_component("AZaz09-_.!~*'()"),
            "AZaz09-_.!~*'()",
            "the unreserved set must survive untouched"
        );
        assert_eq!(
            encode_component("a/b?c#d&e=f+g:h@i;j,k$l"),
            "a%2Fb%3Fc%23d%26e%3Df%2Bg%3Ah%40i%3Bj%2Ck%24l"
        );
        assert_eq!(encode_component(" "), "%20");
        assert_eq!(encode_component("é"), "%C3%A9");
        assert_eq!(encode_component("日"), "%E6%97%A5");
        assert_eq!(encode_component("🙂"), "%F0%9F%99%82");
    }

    #[test]
    fn the_page_query_pins_the_servers_own_ceiling() {
        assert_eq!(LIST_PAGE_LIMIT, 200);
        assert_eq!(tasks_page_query(0), "limit=200&offset=0");
        assert_eq!(tasks_page_query(400), "limit=200&offset=400");
        assert_eq!(TASKS, "/api/tasks");
    }
}
