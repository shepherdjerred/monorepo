//! Pure three-way merge of lossless task documents.

use indexmap::IndexSet;
use tasknotes_vault::{
    document::{PropertyEdit, TaskDocument},
    path::VaultPath,
};

/// Merge independent changes. Outer `None` is overlap; inner `None` is deletion.
#[must_use]
pub fn three_way(
    path: &str,
    base: Option<&[u8]>,
    local: Option<&[u8]>,
    remote: Option<&[u8]>,
) -> Option<Option<Vec<u8>>> {
    if local == remote {
        return Some(local.map(<[u8]>::to_vec));
    }
    if local == base {
        return Some(remote.map(<[u8]>::to_vec));
    }
    if remote == base {
        return Some(local.map(<[u8]>::to_vec));
    }
    let (base, local, remote) = (base?, local?, remote?);
    if !path.to_lowercase().ends_with(".md") {
        return None;
    }
    let path = VaultPath::parse(path).ok()?;
    let base = TaskDocument::parse(path.clone(), base).ok()?;
    let local = TaskDocument::parse(path.clone(), local).ok()?;
    let remote = TaskDocument::parse(path, remote).ok()?;
    let keys: IndexSet<_> = base
        .frontmatter()
        .keys()
        .chain(local.frontmatter().keys())
        .chain(remote.frontmatter().keys())
        .cloned()
        .collect();
    let mut edits = Vec::new();
    for key in keys {
        let (old, left, right) = (
            base.frontmatter().get(&key),
            local.frontmatter().get(&key),
            remote.frontmatter().get(&key),
        );
        if left == right || left == old {
            continue;
        }
        if right != old {
            return None;
        }
        edits.push(if let Some(value) = left {
            PropertyEdit::Set {
                key,
                value: value.clone(),
            }
        } else {
            PropertyEdit::Remove { key }
        });
    }
    let body = merge_text(base.body(), local.body(), remote.body())?;
    Some(Some(remote.plan(&edits, Some(&body)).ok()?.bytes))
}

fn merge_text(base: &str, left: &str, right: &str) -> Option<String> {
    if left == right {
        return Some(left.to_owned());
    }
    if left == base {
        return Some(right.to_owned());
    }
    if right == base {
        return Some(left.to_owned());
    }
    let old: Vec<_> = base.split_inclusive('\n').collect();
    let local: Vec<_> = left.split_inclusive('\n').collect();
    let remote: Vec<_> = right.split_inclusive('\n').collect();
    let local_edit = span(&old, &local);
    let remote_edit = span(&old, &remote);
    if local_edit.0 < remote_edit.1 && remote_edit.0 < local_edit.1 || local_edit.0 == remote_edit.0
    {
        return None;
    }
    let (first, second) = if local_edit.0 < remote_edit.0 {
        (local_edit, remote_edit)
    } else {
        (remote_edit, local_edit)
    };
    let mut result = String::new();
    result.push_str(&old.get(..first.0)?.concat());
    result.push_str(&first.2.concat());
    result.push_str(&old.get(first.1..second.0)?.concat());
    result.push_str(&second.2.concat());
    result.push_str(&old.get(second.1..)?.concat());
    Some(result)
}

fn span<'a>(base: &[&str], edited: &[&'a str]) -> (usize, usize, Vec<&'a str>) {
    let prefix = base
        .iter()
        .zip(edited)
        .take_while(|(left, right)| left == right)
        .count();
    let suffix = base
        .iter()
        .rev()
        .zip(edited.iter().rev())
        .take(
            base.len()
                .saturating_sub(prefix)
                .min(edited.len().saturating_sub(prefix)),
        )
        .take_while(|(left, right)| left == right)
        .count();
    (
        prefix,
        base.len().saturating_sub(suffix),
        edited
            .iter()
            .skip(prefix)
            .take(edited.len().saturating_sub(prefix + suffix))
            .copied()
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::three_way;

    #[test]
    fn combines_independent_properties_and_body_lines() {
        let base = b"---\nstatus: open\npriority: normal\nvendor: '001'\n---\none\ntwo\nthree\n";
        let local = b"---\nstatus: done\npriority: normal\nvendor: '001'\n---\nONE\ntwo\nthree\n";
        let remote = b"---\nstatus: open\npriority: high\nvendor: '001'\n---\none\ntwo\nTHREE\n";
        let merged = three_way("Tasks/a.md", Some(base), Some(local), Some(remote))
            .unwrap()
            .unwrap();
        let text = String::from_utf8(merged).unwrap();
        let document = tasknotes_vault::document::TaskDocument::parse(
            tasknotes_vault::path::VaultPath::parse("Tasks/a.md").unwrap(),
            text.as_bytes(),
        )
        .unwrap();
        assert_eq!(
            document.frontmatter().get("status"),
            Some(&serde_json::json!("done"))
        );
        assert_eq!(
            document.frontmatter().get("priority"),
            Some(&serde_json::json!("high"))
        );
        assert!(text.contains("vendor: '001'"));
        assert!(text.ends_with("ONE\ntwo\nTHREE\n"));
    }

    #[test]
    fn preserves_overlapping_updates_and_deletion_conflicts() {
        assert!(three_way("a.md", Some(b"base"), Some(b"local"), Some(b"remote")).is_none());
        assert!(three_way("a.md", Some(b"base"), None, Some(b"remote")).is_none());
        assert_eq!(
            three_way("a.md", Some(b"base"), None, Some(b"base")),
            Some(None)
        );
    }
}
