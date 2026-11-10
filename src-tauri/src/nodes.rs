// The section/item tree: what /api/nodes, /api/nodes/[id], /api/nodes/[id]/move and the
// writing half of /api/parse and /api/data used to do.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;

use crate::db::{err, new_id, now_iso, Db};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NodeDto {
    pub id: String,
    pub name: String,
    pub category: String,
    pub source: Option<String>,
    pub content: Option<String>,
    pub enabled: bool,
    pub order: i64,
    pub parent_id: Option<String>,
    pub children: Vec<NodeDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInput {
    /// Chosen by the view when the node was staged (Apply/Undo): a pending node can already
    /// have pending children. A missing or malformed id gets a fresh one.
    #[serde(default)]
    pub id: Option<String>,
    pub name: Option<String>,
    pub category: Option<String>,
    pub source: Option<String>,
    pub content: Option<String>,
    pub parent_id: Option<String>,
    pub enabled: Option<bool>,
}

/// A parsed-document or backup node, inserted recursively.
#[derive(Deserialize)]
pub struct ImportNode {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub category: String,
    pub source: Option<String>,
    pub content: Option<String>,
    pub enabled: bool,
    #[serde(default)]
    pub children: Vec<ImportNode>,
}

/// An id the view may choose: 1–64 letters, digits or dashes.
fn chosen_id(id: Option<&str>) -> String {
    match id {
        Some(i) if !i.is_empty() && i.len() <= 64 && i.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') => i.to_string(),
        _ => new_id(),
    }
}

fn category_of(v: Option<&str>) -> &'static str {
    if v == Some("download") { "download" } else { "command" }
}

fn source_of(v: Option<&str>) -> Option<String> {
    match v {
        Some(s @ ("pacman" | "yay" | "github" | "ollama" | "flatpak" | "snap")) => Some(s.to_string()),
        _ => None,
    }
}

/// `body.content ? String(body.content).trim() || null : null`
fn content_of(v: Option<&str>) -> Option<String> {
    v.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

const COLS: &str = "id, name, category, source, content, enabled, ord, parent_id";

fn row_to_dto(r: &rusqlite::Row) -> rusqlite::Result<NodeDto> {
    let category: String = r.get(2)?;
    let source: Option<String> = r.get(3)?;
    Ok(NodeDto {
        id: r.get(0)?,
        name: r.get(1)?,
        category: category_of(Some(&category)).to_string(),
        source: source_of(source.as_deref()),
        content: r.get(4)?,
        enabled: r.get::<_, i64>(5)? != 0,
        order: r.get(6)?,
        parent_id: r.get(7)?,
        children: vec![],
    })
}

fn get_node(conn: &Connection, id: &str) -> rusqlite::Result<Option<NodeDto>> {
    conn.query_row(&format!("SELECT {COLS} FROM node WHERE id = ?1"), [id], row_to_dto)
        .optional()
}

pub fn tree(conn: &Connection) -> rusqlite::Result<Vec<NodeDto>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM node ORDER BY ord ASC, created_at ASC"))?;
    let rows: Vec<NodeDto> = stmt.query_map([], row_to_dto)?.collect::<Result<_, _>>()?;

    // Build bottom-up: children are attached in row order, so sibling order is preserved.
    let ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
    let mut by_id: HashMap<String, NodeDto> = rows.into_iter().map(|r| (r.id.clone(), r)).collect();
    let mut kids: HashMap<String, Vec<String>> = HashMap::new();
    let mut roots: Vec<String> = vec![];
    for id in &ids {
        match by_id[id].parent_id.clone() {
            Some(p) if by_id.contains_key(&p) => kids.entry(p).or_default().push(id.clone()),
            _ => roots.push(id.clone()),
        }
    }
    fn build(id: &str, by_id: &mut HashMap<String, NodeDto>, kids: &HashMap<String, Vec<String>>) -> NodeDto {
        let mut node = by_id.remove(id).expect("node present");
        if let Some(cs) = kids.get(id) {
            node.children = cs.iter().map(|c| build(c, by_id, kids)).collect();
        }
        node
    }
    Ok(roots.iter().map(|r| build(r, &mut by_id, &kids)).collect())
}

fn next_order(conn: &Connection, parent_id: Option<&str>) -> rusqlite::Result<i64> {
    let max: Option<i64> = conn.query_row(
        "SELECT MAX(ord) FROM node WHERE parent_id IS ?1",
        [parent_id],
        |r| r.get(0),
    )?;
    Ok(max.map_or(0, |m| m + 1))
}

pub fn create(conn: &Connection, input: NodeInput) -> Result<NodeDto, String> {
    let name = input.name.as_deref().unwrap_or("").trim().to_string();
    if name.is_empty() {
        return Err("Name is required".into());
    }
    let parent_id = input.parent_id.filter(|p| !p.is_empty());
    if let Some(p) = &parent_id {
        if get_node(conn, p).map_err(err)?.is_none() {
            return Err("Parent not found".into());
        }
    }
    let id = chosen_id(input.id.as_deref());
    if get_node(conn, &id).map_err(err)?.is_some() {
        return Err("A node with that id already exists".into());
    }
    let now = now_iso();
    conn.execute(
        "INSERT INTO node (id, name, category, source, content, enabled, ord, parent_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            name,
            category_of(input.category.as_deref()),
            source_of(input.source.as_deref()),
            content_of(input.content.as_deref()),
            input.enabled != Some(false),
            next_order(conn, parent_id.as_deref()).map_err(err)?,
            parent_id,
            now,
        ],
    )
    .map_err(err)?;
    get_node(conn, &id).map_err(err)?.ok_or_else(|| "Node not found".into())
}

/// True when `candidate` sits somewhere under `ancestor` (walks up from the candidate).
fn is_descendant(conn: &Connection, ancestor: &str, candidate: &str) -> rusqlite::Result<bool> {
    let mut cur = Some(candidate.to_string());
    let mut guard = 0;
    while let Some(id) = cur {
        if guard > 10_000 {
            return Ok(true); // a corrupted cycle: refuse rather than loop
        }
        guard += 1;
        let parent: Option<String> = conn
            .query_row("SELECT parent_id FROM node WHERE id = ?1", [&id], |r| r.get(0))
            .optional()?
            .flatten();
        if parent.as_deref() == Some(ancestor) {
            return Ok(true);
        }
        cur = parent;
    }
    Ok(false)
}

/// A partial update: only the keys present in `patch` change, as the PATCH route did.
pub fn update(conn: &Connection, id: &str, patch: Map<String, Value>) -> Result<NodeDto, String> {
    if get_node(conn, id).map_err(err)?.is_none() {
        return Err("Node not found".into());
    }
    let s = |k: &str| patch.get(k).and_then(Value::as_str);
    let mut sets: Vec<(&str, rusqlite::types::Value)> = vec![];
    use rusqlite::types::Value as V;
    let opt = |o: Option<String>| o.map_or(V::Null, V::Text);

    if patch.contains_key("name") {
        let name = patch["name"].as_str().map(str::trim).unwrap_or("").to_string();
        if name.is_empty() {
            return Err("Name cannot be empty".into());
        }
        sets.push(("name", V::Text(name)));
    }
    if patch.contains_key("category") {
        sets.push(("category", V::Text(category_of(s("category")).into())));
    }
    if patch.contains_key("source") {
        sets.push(("source", opt(source_of(s("source")))));
    }
    if patch.contains_key("content") {
        sets.push(("content", opt(content_of(s("content")))));
    }
    if let Some(v) = patch.get("enabled") {
        let on = match v {
            Value::Bool(b) => *b,
            Value::Null => false,
            Value::Number(n) => n.as_f64() != Some(0.0),
            Value::String(t) => !t.is_empty(),
            _ => true,
        };
        sets.push(("enabled", V::Integer(on as i64)));
    }
    if patch.contains_key("parentId") {
        let parent = s("parentId").filter(|p| !p.is_empty()).map(str::to_string);
        if let Some(p) = &parent {
            if p == id {
                return Err("A node cannot be its own parent".into());
            }
            if is_descendant(conn, id, p).map_err(err)? {
                return Err("Cannot move a section under one of its own subsections".into());
            }
            if get_node(conn, p).map_err(err)?.is_none() {
                return Err("Parent not found".into());
            }
        }
        sets.push(("parent_id", opt(parent)));
    }

    sets.push(("updated_at", V::Text(now_iso())));
    let assign: Vec<String> = sets.iter().enumerate().map(|(i, (c, _))| format!("{c} = ?{}", i + 1)).collect();
    let mut values: Vec<V> = sets.into_iter().map(|(_, v)| v).collect();
    values.push(V::Text(id.to_string()));
    conn.execute(
        &format!("UPDATE node SET {} WHERE id = ?{}", assign.join(", "), values.len()),
        rusqlite::params_from_iter(values),
    )
    .map_err(err)?;
    get_node(conn, id).map_err(err)?.ok_or_else(|| "Node not found".into())
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    if conn.execute("DELETE FROM node WHERE id = ?1", [id]).map_err(err)? == 0 {
        return Err("Node not found".into());
    }
    Ok(())
}

/// Swap order with the previous/next sibling. Ok(false) at either end.
pub fn move_node(conn: &mut Connection, id: &str, direction: &str) -> Result<bool, String> {
    let node = get_node(conn, id).map_err(err)?.ok_or("Node not found")?;
    let mut stmt = conn
        .prepare("SELECT id, ord FROM node WHERE parent_id IS ?1 ORDER BY ord ASC")
        .map_err(err)?;
    let siblings: Vec<(String, i64)> = stmt
        .query_map([node.parent_id.as_deref()], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    drop(stmt);
    let idx = siblings.iter().position(|(sid, _)| sid == id).ok_or("Node not found")?;
    let swap = if direction == "down" { idx + 1 } else { idx.wrapping_sub(1) };
    if swap >= siblings.len() {
        return Ok(false);
    }
    let (a, b) = (&siblings[idx], &siblings[swap]);
    let tx = conn.transaction().map_err(err)?;
    tx.execute("UPDATE node SET ord = ?1 WHERE id = ?2", params![b.1, a.0]).map_err(err)?;
    tx.execute("UPDATE node SET ord = ?1 WHERE id = ?2", params![a.1, b.0]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(true)
}

fn insert_tree(tx: &Connection, node: &ImportNode, parent: Option<&str>, order: i64) -> rusqlite::Result<usize> {
    let id = chosen_id(node.id.as_deref());
    let now = now_iso();
    let name: String = node.name.chars().take(200).collect();
    tx.execute(
        "INSERT INTO node (id, name, category, source, content, enabled, ord, parent_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            name,
            category_of(Some(&node.category)),
            source_of(node.source.as_deref()),
            node.content,
            node.enabled,
            order,
            parent,
            now,
        ],
    )?;
    let mut n = 1;
    for (i, c) in node.children.iter().enumerate() {
        n += insert_tree(tx, c, Some(&id), i as i64)?;
    }
    Ok(n)
}

/// Insert parsed/backup roots. "replace" wipes the tree first; "append" places the new
/// roots after the existing ones. All or nothing.
pub fn import(conn: &mut Connection, roots: &[ImportNode], mode: &str) -> Result<usize, String> {
    let tx = conn.transaction().map_err(err)?;
    if mode == "replace" {
        tx.execute("DELETE FROM node", []).map_err(err)?;
    }
    let base = if mode == "append" { next_order(&tx, None).map_err(err)? } else { 0 };
    let mut n = 0;
    for (i, r) in roots.iter().enumerate() {
        n += insert_tree(&tx, r, None, base + i as i64).map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(n)
}

// ── commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn tree_get(db: tauri::State<'_, Db>) -> Result<Vec<NodeDto>, String> {
    tree(&db.lock().unwrap()).map_err(err)
}

#[tauri::command]
pub async fn node_create(db: tauri::State<'_, Db>, input: NodeInput) -> Result<NodeDto, String> {
    create(&db.lock().unwrap(), input)
}

#[tauri::command]
pub async fn node_update(db: tauri::State<'_, Db>, id: String, patch: Map<String, Value>) -> Result<NodeDto, String> {
    update(&db.lock().unwrap(), &id, patch)
}

#[tauri::command]
pub async fn node_delete(db: tauri::State<'_, Db>, id: String) -> Result<(), String> {
    delete(&db.lock().unwrap(), &id)
}

#[tauri::command]
pub async fn node_move(db: tauri::State<'_, Db>, id: String, direction: String) -> Result<bool, String> {
    move_node(&mut db.lock().unwrap(), &id, &direction)
}

#[tauri::command]
pub async fn nodes_import(db: tauri::State<'_, Db>, roots: Vec<ImportNode>, mode: String) -> Result<usize, String> {
    import(&mut db.lock().unwrap(), &roots, &mode)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_memory;

    fn input(name: &str, parent: Option<&str>) -> NodeInput {
        NodeInput {
            id: None,
            name: Some(name.into()),
            category: None,
            source: None,
            content: None,
            parent_id: parent.map(Into::into),
            enabled: None,
        }
    }

    #[test]
    fn a_section_cannot_move_under_its_own_subsection() {
        let c = open_memory();
        let a = create(&c, input("A", None)).unwrap();
        let b = create(&c, input("B", Some(&a.id))).unwrap();
        let deep = create(&c, input("C", Some(&b.id))).unwrap();
        let mut p = Map::new();
        p.insert("parentId".into(), Value::String(deep.id.clone()));
        assert_eq!(update(&c, &a.id, p).unwrap_err(), "Cannot move a section under one of its own subsections");
        let mut own = Map::new();
        own.insert("parentId".into(), Value::String(a.id.clone()));
        assert_eq!(update(&c, &a.id, own).unwrap_err(), "A node cannot be its own parent");
    }

    #[test]
    fn delete_cascades_and_tree_keeps_sibling_order() {
        let mut c = open_memory();
        let a = create(&c, input("A", None)).unwrap();
        let _b = create(&c, input("B", None)).unwrap();
        create(&c, input("A1", Some(&a.id))).unwrap();
        assert!(move_node(&mut c, &a.id, "down").unwrap());
        let names: Vec<_> = tree(&c).unwrap().into_iter().map(|n| n.name).collect();
        assert_eq!(names, ["B", "A"]);
        assert!(!move_node(&mut c, &a.id, "down").unwrap(), "already last");
        delete(&c, &a.id).unwrap();
        let left: i64 = c.query_row("SELECT COUNT(*) FROM node", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 1, "A1 went with A");
    }

    #[test]
    fn a_chosen_id_is_kept_and_a_bad_one_replaced() {
        let c = open_memory();
        let mut i = input("A", None);
        i.id = Some("pending-1a2b".into());
        assert_eq!(create(&c, i).unwrap().id, "pending-1a2b");
        let mut j = input("B", Some("pending-1a2b"));
        j.id = Some("../evil id".into());
        let b = create(&c, j).unwrap();
        assert_ne!(b.id, "../evil id");
        assert_eq!(b.parent_id.as_deref(), Some("pending-1a2b"));
        let mut dup = input("C", None);
        dup.id = Some("pending-1a2b".into());
        assert!(create(&c, dup).is_err(), "an id is never reused");
    }

    #[test]
    fn patch_changes_only_present_keys() {
        let c = open_memory();
        let mut i = input("X", None);
        i.content = Some("  echo hi  ".into());
        let n = create(&c, i).unwrap();
        assert_eq!(n.content.as_deref(), Some("echo hi"));
        let mut p = Map::new();
        p.insert("enabled".into(), Value::Bool(false));
        let n = update(&c, &n.id, p).unwrap();
        assert!(!n.enabled);
        assert_eq!(n.content.as_deref(), Some("echo hi"));
        assert_eq!(n.name, "X");
    }

    #[test]
    fn import_appends_after_existing_roots_and_counts_every_node() {
        let mut c = open_memory();
        create(&c, input("Existing", None)).unwrap();
        let roots = vec![ImportNode {
            id: None,
            name: "New".into(),
            category: "command".into(),
            source: Some("bogus".into()),
            content: None,
            enabled: true,
            children: vec![ImportNode {
                id: None,
                name: "firefox".into(),
                category: "download".into(),
                source: Some("pacman".into()),
                content: Some("firefox".into()),
                enabled: true,
                children: vec![],
            }],
        }];
        assert_eq!(import(&mut c, &roots, "append").unwrap(), 2);
        let t = tree(&c).unwrap();
        assert_eq!(t.iter().map(|n| n.name.as_str()).collect::<Vec<_>>(), ["Existing", "New"]);
        assert_eq!(t[1].source, None, "unknown sources are dropped");
        assert_eq!(t[1].children[0].source.as_deref(), Some("pacman"));
        assert_eq!(import(&mut c, &roots, "replace").unwrap(), 2);
        assert_eq!(tree(&c).unwrap().len(), 1);
    }
}
