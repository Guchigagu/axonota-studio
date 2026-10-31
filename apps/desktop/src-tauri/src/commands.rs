use std::fs;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{safe_join, AppState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime: u64,
}

#[tauri::command]
pub fn vault_root(state: State<'_, AppState>) -> String {
    state.root.to_string_lossy().to_string()
}

/// 用系统默认浏览器打开外部链接；只允许 http/https，避免把其它协议交给系统
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    let u = url.trim();
    if !(u.starts_with("https://") || u.starts_with("http://")) {
        return Err("只允许打开 http/https 链接".into());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(u)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("打开链接失败：{e}"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}

/// 用系统默认程序打开 vault 内的文件
#[tauri::command]
pub fn open_local_file(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let target = safe_join(&state.root, &path)?;
    if !target.exists() {
        return Err("文件不存在，请重新生成。".into());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &target.to_string_lossy()])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("打开文件失败：{e}"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = target;
        Ok(())
    }
}

/// 归档导出：写到「文档/Axonota Exports」，同名时追加序号；返回最终路径
#[tauri::command]
pub fn save_archive(name: String, data: Vec<u8>, state: State<'_, AppState>) -> Result<String, String> {
    let safe: String = name
        .replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "_")
        .trim()
        .to_string();
    let file_name = if safe.is_empty() { "axonota-archive.zip".to_string() } else { safe };
    let dir = std::env::var("USERPROFILE")
        .ok()
        .map(|p| std::path::PathBuf::from(p).join("Documents").join("Axonota Exports"))
        .unwrap_or_else(|| state.root.join("exports"));
    fs::create_dir_all(&dir).map_err(|e| format!("创建导出目录失败: {e}"))?;
    let mut target = dir.join(&file_name);
    if target.exists() {
        let stem = std::path::Path::new(&file_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("axonota-archive");
        let ext = std::path::Path::new(&file_name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("zip");
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        target = dir.join(format!("{stem}-{ts}.{ext}"));
    }
    fs::write(&target, data).map_err(|e| format!("写入归档失败: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

/// 打开系统回收站，作为删除后的恢复入口
#[tauri::command]
pub fn open_recycle_bin() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("shell:RecycleBinFolder")
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("打开回收站失败：{e}"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}

/// 在资源管理器里定位导出文件
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{path}"))
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("打开文件位置失败：{e}"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}

#[tauri::command]
pub fn fs_exists(path: String, state: State<'_, AppState>) -> Result<bool, String> {
    Ok(safe_join(&state.root, &path)?.exists())
}

#[tauri::command]
pub fn fs_read_text(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let p = safe_join(&state.root, &path)?;
    fs::read_to_string(&p).map_err(|e| format!("读取失败 {}: {e}", p.display()))
}

#[tauri::command]
pub fn fs_write_text(path: String, data: String, state: State<'_, AppState>) -> Result<(), String> {
    let p = safe_join(&state.root, &path)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::write(&p, data).map_err(|e| format!("写入失败 {}: {e}", p.display()))
}

#[tauri::command]
pub fn fs_read_binary(path: String, state: State<'_, AppState>) -> Result<Vec<u8>, String> {
    let p = safe_join(&state.root, &path)?;
    fs::read(&p).map_err(|e| format!("读取失败 {}: {e}", p.display()))
}

#[tauri::command]
pub fn fs_write_binary(
    path: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let p = safe_join(&state.root, &path)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::write(&p, data).map_err(|e| format!("写入失败 {}: {e}", p.display()))
}

#[tauri::command]
pub fn fs_list(path: String, state: State<'_, AppState>) -> Result<Vec<DirEntry>, String> {
    let dir = safe_join(&state.root, &path)?;
    let mut out = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(out),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let meta = entry.metadata().ok();
        out.push(DirEntry {
            name,
            is_dir: meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
            size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            mtime: meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn fs_mkdir(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let p = safe_join(&state.root, &path)?;
    fs::create_dir_all(&p).map_err(|e| format!("创建目录失败: {e}"))
}

/// 删除交给系统回收站，可从回收站恢复（D-020）
#[tauri::command]
pub fn fs_trash(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let p = safe_join(&state.root, &path)?;
    if !p.exists() {
        return Ok(());
    }
    trash::delete(&p).map_err(|e| format!("移入回收站失败: {e}"))
}

#[tauri::command]
pub fn fs_rename(from: String, to: String, state: State<'_, AppState>) -> Result<(), String> {
    let a = safe_join(&state.root, &from)?;
    let b = safe_join(&state.root, &to)?;
    fs::rename(&a, &b).map_err(|e| format!("重命名失败: {e}"))
}

#[tauri::command]
pub fn fs_resolve(path: String, state: State<'_, AppState>) -> Result<String, String> {
    Ok(safe_join(&state.root, &path)?.to_string_lossy().to_string())
}

// ------------------------------------------------------------------ 全文索引

#[derive(Deserialize)]
pub struct IndexDoc {
    pub path: String,
    pub notebook_id: String,
    pub node_id: String,
    pub title: String,
    pub body: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub notebook_id: String,
    pub node_id: String,
    pub title: String,
    pub snippet: String,
}

#[tauri::command]
pub fn index_upsert(doc: IndexDoc, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM docs WHERE path = ?1", [&doc.path])
        .map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO docs (path, notebook_id, node_id, title, body) VALUES (?1, ?2, ?3, ?4, ?5)",
        (&doc.path, &doc.notebook_id, &doc.node_id, &doc.title, &doc.body),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn index_remove(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM docs WHERE path = ?1", [&path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn index_search(
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<SearchHit>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT path, notebook_id, node_id, title, snippet(docs, 4, '<b>', '</b>', '…', 16)
             FROM docs WHERE docs MATCH ?1 ORDER BY rank LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map((query, limit.unwrap_or(20) as i64), |row| {
            Ok(SearchHit {
                path: row.get(0)?,
                notebook_id: row.get(1)?,
                node_id: row.get(2)?,
                title: row.get(3)?,
                snippet: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}
