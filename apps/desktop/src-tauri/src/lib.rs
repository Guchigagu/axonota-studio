use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

pub mod commands;

pub struct AppState {
    pub root: PathBuf,
    pub db: Mutex<Connection>,
}

pub(crate) fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err("拒绝绝对路径".into());
    }
    for part in rel_path.components() {
        if matches!(part, std::path::Component::ParentDir) {
            return Err("拒绝越界路径".into());
        }
    }
    Ok(root.join(rel_path))
}

pub fn init_state(app: &tauri::AppHandle) -> Result<AppState, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?.join("vault");
    fs::create_dir_all(&dir)?;
    let db = Connection::open(dir.join("index.sqlite"))?;
    db.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(
            path UNINDEXED, notebook_id UNINDEXED, node_id UNINDEXED, title, body,
            tokenize='unicode61'
         );",
    )?;
    Ok(AppState {
        root: dir,
        db: Mutex::new(db),
    })
}
