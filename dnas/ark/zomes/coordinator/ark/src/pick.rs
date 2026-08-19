/// Pure head-selection rule, shared by document version chains and folder-tree
/// forks: newest timestamp wins, ties broken by hash bytes so every peer picks
/// the same head from the same data. Deliberately free of hdk types so it runs
/// under a plain host-target `cargo test`.
pub fn pick_head<H: AsRef<[u8]> + Clone>(candidates: &[(H, i64)]) -> Option<H> {
    candidates
        .iter()
        .max_by(|(a_hash, a_ts), (b_hash, b_ts)| {
            a_ts.cmp(b_ts).then_with(|| a_hash.as_ref().cmp(b_hash.as_ref()))
        })
        .map(|(hash, _)| hash.clone())
}

#[cfg(test)]
mod tests {
    use super::pick_head;

    #[test]
    fn picks_the_newest_candidate() {
        let candidates = [("a", 10i64), ("b", 30), ("c", 20)];
        assert_eq!(pick_head(&candidates), Some("b"));
    }

    #[test]
    fn breaks_timestamp_ties_by_hash_bytes() {
        let candidates = [("b", 30i64), ("a", 30)];
        assert_eq!(pick_head(&candidates), Some("b"));
        let reversed = [("a", 30i64), ("b", 30)];
        assert_eq!(pick_head(&reversed), Some("b"));
    }

    #[test]
    fn returns_none_for_no_candidates() {
        let empty: [(&str, i64); 0] = [];
        assert_eq!(pick_head(&empty), None);
    }
}
