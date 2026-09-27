//! Datenhaltung: Alle Lerndaten liegen als eine JSON-Datei im Datenordner.
//!
//! Der Datenordner kann ein Cloud-Ordner (OneDrive, Sciebo, …) sein, damit PC
//! und Laptop dieselben Daten sehen. Deshalb:
//! - wird atomar geschrieben (erst temporäre Datei, dann umbenennen), damit der
//!   Sync-Client nie eine halb geschriebene Datei hochlädt,
//! - trägt jede Speicherung eine Revisionsnummer, damit Änderungen von einem
//!   anderen Gerät erkannt und nicht still überschrieben werden,
//! - zeigt eine Lock-Datei an, ob die App gerade auf einem anderen Gerät offen ist,
//! - wird täglich eine Sicherung angelegt.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

pub const DATA_FILE: &str = "fokus-daten.json";
const TMP_FILE: &str = ".fokus-daten.json.tmp";
const LOCK_FILE: &str = "fokus.lock";
const BACKUP_DIR: &str = "sicherungen";
const MUSIC_DIR: &str = "musik";
const DEVICE_CONFIG: &str = "geraet.json";
const LOCK_STALE_MS: i64 = 150_000;
const MAX_BACKUPS: usize = 14;
const AUDIO_EXTENSIONS: &[&str] = &["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "webm"];

#[derive(Default, Serialize, Deserialize, Clone)]
struct DeviceConfig {
    data_dir: Option<String>,
}

pub struct StorageState {
    /// Aktiver Datenordner. `None`, wenn der eingestellte Ordner nicht erreichbar ist.
    pub data_dir: Mutex<Option<PathBuf>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    data_dir: Option<String>,
    default_dir: String,
    missing_dir: Option<String>,
    device: String,
    music_dir: Option<String>,
    is_default: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirInspection {
    exists: bool,
    has_data: bool,
    data_modified_ms: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadResult {
    content: Option<String>,
    revision: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    ok: bool,
    conflict: bool,
    current_revision: u64,
}

#[derive(Serialize, Deserialize)]
struct LockFile {
    device: String,
    heartbeat: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockStatus {
    other_device: Option<String>,
    other_heartbeat: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    file: String,
    modified_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTrack {
    id: String,
    file: String,
    original: String,
    title: String,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
}

pub fn device_name() -> String {
    gethostname::gethostname().to_string_lossy().to_string()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map(|d| d.join(DEVICE_CONFIG)).map_err(err)
}

fn default_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(err)
}

fn read_config(app: &AppHandle) -> DeviceConfig {
    config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_config(app: &AppHandle, cfg: &DeviceConfig) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::write(path, serde_json::to_string_pretty(cfg).map_err(err)?).map_err(err)
}

fn allow_music_dir(app: &AppHandle, dir: &Path) {
    let music = dir.join(MUSIC_DIR);
    let _ = fs::create_dir_all(&music);
    let _ = app.asset_protocol_scope().allow_directory(&music, true);
}

/// Ermittelt beim Start den Datenordner. Ist ein eigener Ordner eingestellt,
/// der gerade nicht existiert (z. B. Cloud-Laufwerk noch nicht bereit), wird
/// bewusst NICHT auf den Standardordner ausgewichen – sonst entstünden zwei
/// auseinanderlaufende Datenstände. Die Oberfläche fragt dann nach.
pub fn init(app: &AppHandle) -> StorageState {
    let cfg = read_config(app);
    let dir = match cfg.data_dir {
        Some(custom) => {
            let p = PathBuf::from(custom);
            if p.is_dir() {
                Some(p)
            } else {
                None
            }
        }
        None => default_data_dir(app).ok().and_then(|d| fs::create_dir_all(&d).ok().map(|_| d)),
    };
    if let Some(d) = &dir {
        allow_music_dir(app, d);
    }
    StorageState { data_dir: Mutex::new(dir) }
}

fn current_dir(state: &State<'_, StorageState>) -> Result<PathBuf, String> {
    state
        .data_dir
        .lock()
        .map_err(err)?
        .clone()
        .ok_or_else(|| "Der Datenordner ist gerade nicht erreichbar.".to_string())
}

pub fn active_dir(app: &AppHandle) -> Option<PathBuf> {
    app.try_state::<StorageState>()?.data_dir.lock().ok().and_then(|d| d.clone())
}

fn build_info(app: &AppHandle, state: &State<'_, StorageState>) -> Result<StorageInfo, String> {
    let cfg = read_config(app);
    let default = default_data_dir(app)?;
    let dir = state.data_dir.lock().map_err(err)?.clone();
    let missing = match (&dir, &cfg.data_dir) {
        (None, Some(custom)) => Some(custom.clone()),
        _ => None,
    };
    Ok(StorageInfo {
        data_dir: dir.as_ref().map(|d| d.to_string_lossy().to_string()),
        default_dir: default.to_string_lossy().to_string(),
        missing_dir: missing,
        device: device_name(),
        music_dir: dir.as_ref().map(|d| d.join(MUSIC_DIR).to_string_lossy().to_string()),
        is_default: cfg.data_dir.is_none(),
    })
}

#[tauri::command]
pub fn storage_info(app: AppHandle, state: State<'_, StorageState>) -> Result<StorageInfo, String> {
    build_info(&app, &state)
}

/// Prüft erneut, ob der eingestellte Ordner inzwischen erreichbar ist.
#[tauri::command]
pub fn storage_retry(app: AppHandle, state: State<'_, StorageState>) -> Result<StorageInfo, String> {
    let fresh = init(&app);
    let dir = fresh.data_dir.into_inner().map_err(err)?;
    *state.data_dir.lock().map_err(err)? = dir;
    build_info(&app, &state)
}

#[tauri::command]
pub fn storage_use_default(app: AppHandle, state: State<'_, StorageState>) -> Result<StorageInfo, String> {
    write_config(&app, &DeviceConfig::default())?;
    let dir = default_data_dir(&app)?;
    fs::create_dir_all(&dir).map_err(err)?;
    allow_music_dir(&app, &dir);
    *state.data_dir.lock().map_err(err)? = Some(dir);
    build_info(&app, &state)
}

#[tauri::command]
pub fn storage_inspect_dir(path: String) -> DirInspection {
    let dir = PathBuf::from(path);
    let data = dir.join(DATA_FILE);
    let modified = fs::metadata(&data)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);
    DirInspection { exists: dir.is_dir(), has_data: data.is_file(), data_modified_ms: modified }
}

fn copy_dir_files(from: &Path, to: &Path) -> Result<(), String> {
    if !from.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(to).map_err(err)?;
    for entry in fs::read_dir(from).map_err(err)? {
        let entry = entry.map_err(err)?;
        let src = entry.path();
        if src.is_file() {
            let dst = to.join(entry.file_name());
            if !dst.exists() {
                fs::copy(&src, &dst).map_err(err)?;
            }
        }
    }
    Ok(())
}

/// Wechselt den Datenordner.
/// - `mode = "use-existing"`: Im Zielordner liegende Daten werden übernommen
///   (typisch für das zweite Gerät).
/// - `mode = "move-current"`: Die aktuellen Daten werden in den Zielordner
///   kopiert. Eine dort schon vorhandene Datei wird vorher umbenannt, damit
///   nichts verloren geht.
#[tauri::command]
pub fn storage_set_dir(
    app: AppHandle,
    state: State<'_, StorageState>,
    path: String,
    mode: String,
) -> Result<StorageInfo, String> {
    let target = PathBuf::from(&path);
    fs::create_dir_all(&target).map_err(err)?;
    let current = state.data_dir.lock().map_err(err)?.clone();

    if mode == "move-current" {
        if let Some(cur) = &current {
            if cur != &target {
                let target_data = target.join(DATA_FILE);
                if target_data.exists() {
                    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
                    fs::rename(&target_data, target.join(format!("fokus-daten.vorher-{stamp}.json")))
                        .map_err(err)?;
                }
                let src_data = cur.join(DATA_FILE);
                if src_data.exists() {
                    fs::copy(&src_data, &target_data).map_err(err)?;
                }
                copy_dir_files(&cur.join(MUSIC_DIR), &target.join(MUSIC_DIR))?;
                release_lock_in(cur);
            }
        }
    }

    let default = default_data_dir(&app)?;
    let cfg = DeviceConfig { data_dir: if target == default { None } else { Some(path) } };
    write_config(&app, &cfg)?;
    allow_music_dir(&app, &target);
    *state.data_dir.lock().map_err(err)? = Some(target);
    build_info(&app, &state)
}

fn read_revision(path: &Path) -> u64 {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("meta")?.get("revision")?.as_u64())
        .unwrap_or(0)
}

fn is_valid_json(path: &Path) -> bool {
    fs::read_to_string(path)
        .ok()
        .map(|s| serde_json::from_str::<serde_json::Value>(&s).is_ok())
        .unwrap_or(false)
}

fn write_atomic(dir: &Path, target: &Path, content: &[u8]) -> Result<(), String> {
    let tmp = dir.join(TMP_FILE);
    {
        let mut f = fs::File::create(&tmp).map_err(err)?;
        f.write_all(content).map_err(err)?;
        f.sync_all().map_err(err)?;
    }
    // Sync-Clients halten Dateien manchmal kurz geöffnet – dann erneut versuchen.
    let mut last = String::new();
    for attempt in 0..6u64 {
        match fs::rename(&tmp, target) {
            Ok(_) => return Ok(()),
            Err(e) => {
                last = e.to_string();
                std::thread::sleep(Duration::from_millis(120 * (attempt + 1)));
            }
        }
    }
    Err(format!("Speichern fehlgeschlagen: {last}"))
}

#[tauri::command]
pub async fn data_load(state: State<'_, StorageState>) -> Result<LoadResult, String> {
    let dir = current_dir(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = dir.join(DATA_FILE);
        if !path.exists() {
            return Ok(LoadResult { content: None, revision: 0 });
        }
        let content = fs::read_to_string(&path).map_err(err)?;
        let revision = serde_json::from_str::<serde_json::Value>(&content)
            .ok()
            .and_then(|v| v.get("meta")?.get("revision")?.as_u64())
            .unwrap_or(0);
        Ok(LoadResult { content: Some(content), revision })
    })
    .await
    .map_err(err)?
}

/// Speichert die Daten. `base_revision` ist die Revision, auf der die Änderungen
/// beruhen. Hat inzwischen ein anderes Gerät gespeichert, wird mit
/// `conflict = true` abgebrochen (außer bei `force`).
#[tauri::command]
pub async fn data_save(
    state: State<'_, StorageState>,
    content: String,
    base_revision: u64,
    force: bool,
) -> Result<SaveResult, String> {
    let dir = current_dir(&state)?;
    tauri::async_runtime::spawn_blocking(move || save_in_dir(&dir, &content, base_revision, force))
        .await
        .map_err(err)?
}

fn save_in_dir(dir: &Path, content: &str, base_revision: u64, force: bool) -> Result<SaveResult, String> {
    let path = dir.join(DATA_FILE);
    if path.exists() && !is_valid_json(&path) {
        // Beschädigte Datei nicht überschreiben, sondern beiseitelegen.
        let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
        fs::rename(&path, dir.join(format!("fokus-daten.beschaedigt-{stamp}.json"))).map_err(err)?;
    }
    let current = if path.exists() { read_revision(&path) } else { 0 };
    if !force && path.exists() && current != base_revision {
        return Ok(SaveResult { ok: false, conflict: true, current_revision: current });
    }
    write_atomic(dir, &path, content.as_bytes())?;
    Ok(SaveResult { ok: true, conflict: false, current_revision: read_revision(&path) })
}

#[tauri::command]
pub async fn data_revision(state: State<'_, StorageState>) -> Result<u64, String> {
    let dir = current_dir(&state)?;
    tauri::async_runtime::spawn_blocking(move || read_revision(&dir.join(DATA_FILE)))
        .await
        .map_err(err)
}

/// Legt einmal pro Tag eine Sicherung an und behält die letzten 14.
#[tauri::command]
pub fn data_backup(state: State<'_, StorageState>) -> Result<Option<String>, String> {
    let dir = current_dir(&state)?;
    let src = dir.join(DATA_FILE);
    if !src.exists() {
        return Ok(None);
    }
    let bdir = dir.join(BACKUP_DIR);
    fs::create_dir_all(&bdir).map_err(err)?;
    let name = format!("fokus-daten-{}.json", chrono::Local::now().format("%Y-%m-%d"));
    let dst = bdir.join(&name);
    let created = if dst.exists() {
        None
    } else {
        fs::copy(&src, &dst).map_err(err)?;
        Some(name)
    };
    let mut files: Vec<PathBuf> = fs::read_dir(&bdir)
        .map_err(err)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("fokus-daten-") && n.ends_with(".json"))
                .unwrap_or(false)
        })
        .collect();
    files.sort();
    while files.len() > MAX_BACKUPS {
        let oldest = files.remove(0);
        let _ = fs::remove_file(oldest);
    }
    Ok(created)
}

#[tauri::command]
pub fn backup_list(state: State<'_, StorageState>) -> Result<Vec<BackupEntry>, String> {
    let bdir = current_dir(&state)?.join(BACKUP_DIR);
    if !bdir.is_dir() {
        return Ok(vec![]);
    }
    let mut out: Vec<BackupEntry> = fs::read_dir(&bdir)
        .map_err(err)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
        .map(|e| {
            let modified = e
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            BackupEntry { file: e.file_name().to_string_lossy().to_string(), modified_ms: modified }
        })
        .collect();
    out.sort_by(|a, b| b.file.cmp(&a.file));
    Ok(out)
}

fn safe_file_name(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name.contains("..") {
        return Err("Ungültiger Dateiname".into());
    }
    Ok(name)
}

#[tauri::command]
pub fn backup_read(state: State<'_, StorageState>, file: String) -> Result<String, String> {
    let name = safe_file_name(&file)?;
    fs::read_to_string(current_dir(&state)?.join(BACKUP_DIR).join(name)).map_err(err)
}

fn release_lock_in(dir: &Path) {
    let path = dir.join(LOCK_FILE);
    let mine = fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<LockFile>(&s).ok())
        .map(|l| l.device == device_name())
        .unwrap_or(false);
    if mine {
        let _ = fs::remove_file(path);
    }
}

pub fn release_lock(app: &AppHandle) {
    if let Some(dir) = active_dir(app) {
        release_lock_in(&dir);
    }
}

/// Meldet, ob die App gerade auf einem anderen Gerät geöffnet ist, und
/// erneuert andernfalls die eigene Markierung.
#[tauri::command]
pub fn lock_heartbeat(state: State<'_, StorageState>) -> Result<LockStatus, String> {
    let dir = current_dir(&state)?;
    let path = dir.join(LOCK_FILE);
    let me = device_name();
    if let Some(other) = fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<LockFile>(&s).ok())
    {
        if other.device != me && now_ms() - other.heartbeat < LOCK_STALE_MS {
            return Ok(LockStatus { other_device: Some(other.device), other_heartbeat: Some(other.heartbeat) });
        }
    }
    let lock = LockFile { device: me, heartbeat: now_ms() };
    fs::write(&path, serde_json::to_string(&lock).map_err(err)?).map_err(err)?;
    Ok(LockStatus { other_device: None, other_heartbeat: None })
}

#[tauri::command]
pub fn lock_release(app: AppHandle) {
    release_lock(&app);
}

fn new_id(index: usize) -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}{:02x}", nanos, index % 256)
}

fn read_tags(path: &Path) -> (Option<String>, Option<String>, Option<String>, Option<f64>) {
    use lofty::prelude::*;
    match lofty::read_from_path(path) {
        Ok(tagged) => {
            let duration = Some(tagged.properties().duration().as_secs_f64()).filter(|d| *d > 0.0);
            let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
            let title = tag.and_then(|t| t.title().map(|s| s.trim().to_string())).filter(|s| !s.is_empty());
            let artist = tag.and_then(|t| t.artist().map(|s| s.trim().to_string())).filter(|s| !s.is_empty());
            let album = tag.and_then(|t| t.album().map(|s| s.trim().to_string())).filter(|s| !s.is_empty());
            (title, artist, album, duration)
        }
        Err(_) => (None, None, None, None),
    }
}

/// Kopiert Audiodateien in den Musikordner (innerhalb des Datenordners, damit
/// sie mit dem Cloud-Ordner auch auf dem zweiten Gerät verfügbar sind).
#[tauri::command]
pub async fn music_import(
    state: State<'_, StorageState>,
    paths: Vec<String>,
) -> Result<Vec<ImportedTrack>, String> {
    let music = current_dir(&state)?.join(MUSIC_DIR);
    tauri::async_runtime::spawn_blocking(move || {
        fs::create_dir_all(&music).map_err(err)?;
        let mut out = Vec::new();
        for (i, p) in paths.iter().enumerate() {
            let src = PathBuf::from(p);
            let ext = src
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
                .unwrap_or_default();
            if !src.is_file() || !AUDIO_EXTENSIONS.contains(&ext.as_str()) {
                continue;
            }
            let id = new_id(i);
            let file = format!("{id}.{ext}");
            fs::copy(&src, music.join(&file)).map_err(err)?;
            let original = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let (title, artist, album, duration) = read_tags(&music.join(&file));
            out.push(ImportedTrack {
                id,
                file,
                title: title.unwrap_or_else(|| original.clone()),
                original,
                artist,
                album,
                duration,
            });
        }
        Ok(out)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn music_delete(state: State<'_, StorageState>, file: String) -> Result<(), String> {
    let name = safe_file_name(&file)?;
    let path = current_dir(&state)?.join(MUSIC_DIR).join(name);
    if path.exists() {
        fs::remove_file(path).map_err(err)?;
    }
    Ok(())
}

/// Misst Lautheit (LUFS) und Spitzenpegel eines Titels im Musikordner (`None`, wenn nicht messbar).
#[tauri::command]
pub async fn music_loudness(
    state: State<'_, StorageState>,
    file: String,
) -> Result<Option<crate::loudness::Measurement>, String> {
    let name = safe_file_name(&file)?.to_string();
    let path = current_dir(&state)?.join(MUSIC_DIR).join(name);
    if !path.is_file() {
        return Err("Datei nicht gefunden".into());
    }
    tauri::async_runtime::spawn_blocking(move || crate::loudness::measure(&path))
        .await
        .map_err(err)?
}

/// Hilfsfunktionen für Import/Export über Dateidialoge.
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || fs::read_to_string(path).map_err(err))
        .await
        .map_err(err)?
}

#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || fs::write(path, content).map_err(err))
        .await
        .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fokus-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn doc(rev: u64) -> String {
        format!(r#"{{"schema":1,"meta":{{"revision":{rev},"savedBy":"Test"}},"modules":[]}}"#)
    }

    #[test]
    fn saves_and_detects_conflicts() {
        let dir = temp_dir("conflict");
        // erste Speicherung ohne vorhandene Datei
        let r = save_in_dir(&dir, &doc(1), 0, false).unwrap();
        assert!(r.ok && r.current_revision == 1);
        // Folgespeicherung auf Basis von Revision 1
        let r = save_in_dir(&dir, &doc(2), 1, false).unwrap();
        assert!(r.ok && r.current_revision == 2);
        // anderes Gerät hat noch Revision 1 als Basis → Konflikt
        let r = save_in_dir(&dir, &doc(2), 1, false).unwrap();
        assert!(!r.ok && r.conflict && r.current_revision == 2);
        // bewusst überschreiben
        let r = save_in_dir(&dir, &doc(3), 1, true).unwrap();
        assert!(r.ok && r.current_revision == 3);
        assert!(!dir.join(TMP_FILE).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_damaged_file() {
        let dir = temp_dir("damaged");
        fs::write(dir.join(DATA_FILE), "{ kaputt").unwrap();
        let r = save_in_dir(&dir, &doc(1), 0, false).unwrap();
        assert!(r.ok);
        let damaged = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().starts_with("fokus-daten.beschaedigt-"));
        assert!(damaged, "beschädigte Datei muss erhalten bleiben");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_path_tricks() {
        assert!(safe_file_name("../geheim").is_err());
        assert!(safe_file_name("a\\b.mp3").is_err());
        assert!(safe_file_name("abc.mp3").is_ok());
    }
}
