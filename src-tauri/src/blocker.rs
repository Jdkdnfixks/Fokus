//! Website-Blocker über die hosts-Datei.
//!
//! Während einer Lernphase werden die eingestellten Domains auf 0.0.0.0
//! umgeleitet, danach wieder freigegeben. Die hosts-Datei darf normalerweise
//! nur ein Administrator ändern. Deshalb gibt es eine einmalige Einrichtung:
//! Per UAC-Abfrage erhält das eigene Windows-Konto Schreibrecht auf genau diese
//! Datei. Danach klappt das Blockieren ohne weitere Abfragen. Die Berechtigung
//! lässt sich in den Einstellungen jederzeit wieder entfernen.

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::path::PathBuf;

const BEGIN: &str = "# >>> Fokus-Blocker (automatisch verwaltet, bitte nicht bearbeiten) >>>";
const END: &str = "# <<< Fokus-Blocker <<<";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockerStatus {
    hosts_path: String,
    writable: bool,
    active: bool,
    blocked: Vec<String>,
    supported_setup: bool,
}

fn hosts_path() -> PathBuf {
    #[cfg(windows)]
    {
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        PathBuf::from(root).join("System32").join("drivers").join("etc").join("hosts")
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("/etc/hosts")
    }
}

/// Lässt nur saubere Domainnamen zu (verhindert, dass beliebiger Text in die
/// hosts-Datei gelangt). Entfernt Protokoll, Pfad und führendes "www.".
pub fn normalize_domain(input: &str) -> Option<String> {
    let mut d = input.trim().to_lowercase();
    for prefix in ["https://", "http://"] {
        if let Some(rest) = d.strip_prefix(prefix) {
            d = rest.to_string();
        }
    }
    let d = d.split(['/', '?', '#', ':']).next().unwrap_or("").trim_matches('.');
    let d = d.strip_prefix("www.").unwrap_or(d);
    let valid = !d.is_empty()
        && d.len() <= 253
        && d.contains('.')
        && d.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
        && !d.split('.').any(|label| label.is_empty() || label.starts_with('-') || label.ends_with('-'));
    valid.then(|| d.to_string())
}

fn is_writable() -> bool {
    OpenOptions::new().append(true).open(hosts_path()).is_ok()
}

fn newline(content: &str) -> &'static str {
    if content.contains("\r\n") || cfg!(windows) {
        "\r\n"
    } else {
        "\n"
    }
}

/// Entfernt einen vorhandenen Fokus-Block und liefert (Rest, blockierte Domains).
fn strip_block(content: &str) -> (String, Vec<String>) {
    let nl = newline(content);
    let mut out: Vec<&str> = Vec::new();
    let mut blocked = Vec::new();
    let mut inside = false;
    for line in content.lines() {
        if line.trim() == BEGIN {
            inside = true;
            continue;
        }
        if line.trim() == END {
            inside = false;
            continue;
        }
        if inside {
            if let Some(domain) = line.split_whitespace().nth(1) {
                if line.starts_with("0.0.0.0") && !domain.starts_with("www.") {
                    blocked.push(domain.to_string());
                }
            }
        } else {
            out.push(line);
        }
    }
    while out.last().map(|l| l.trim().is_empty()).unwrap_or(false) {
        out.pop();
    }
    let mut rest = out.join(nl);
    rest.push_str(nl);
    (rest, blocked)
}

fn flush_dns() {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("ipconfig")
            .arg("/flushdns")
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}

fn write_hosts(content: &str) -> Result<(), String> {
    fs::write(hosts_path(), content).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            "Keine Schreibrechte für die hosts-Datei. Bitte den Blocker in den Einstellungen einrichten.".to_string()
        } else {
            e.to_string()
        }
    })
}

#[tauri::command]
pub fn blocker_status() -> BlockerStatus {
    let content = fs::read_to_string(hosts_path()).unwrap_or_default();
    let (_, blocked) = strip_block(&content);
    BlockerStatus {
        hosts_path: hosts_path().to_string_lossy().to_string(),
        writable: is_writable(),
        active: content.contains(BEGIN),
        blocked,
        supported_setup: cfg!(windows),
    }
}

#[tauri::command]
pub async fn blocker_apply(domains: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || apply_domains(domains))
        .await
        .map_err(|e| e.to_string())?
}

fn apply_domains(domains: Vec<String>) -> Result<Vec<String>, String> {
    let mut clean: Vec<String> = domains.iter().filter_map(|d| normalize_domain(d)).collect();
    clean.sort();
    clean.dedup();
    let content = fs::read_to_string(hosts_path()).map_err(|e| e.to_string())?;
    let (rest, _) = strip_block(&content);
    if clean.is_empty() {
        write_hosts(&rest)?;
        flush_dns();
        return Ok(clean);
    }
    let nl = newline(&content);
    let mut block = String::new();
    block.push_str(nl);
    block.push_str(BEGIN);
    block.push_str(nl);
    for d in &clean {
        for host in [d.clone(), format!("www.{d}")] {
            block.push_str(&format!("0.0.0.0 {host}{nl}:: {host}{nl}"));
        }
    }
    block.push_str(END);
    block.push_str(nl);
    write_hosts(&(rest + &block))?;
    flush_dns();
    Ok(clean)
}

/// Entfernt die Sperre. Wird auch beim Beenden und beim Start aufgerufen,
/// damit nach einem Absturz keine Seiten dauerhaft gesperrt bleiben.
#[tauri::command]
pub async fn blocker_clear() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(clear_block)
        .await
        .map_err(|e| e.to_string())?
}

fn clear_block() -> Result<(), String> {
    let content = fs::read_to_string(hosts_path()).map_err(|e| e.to_string())?;
    if !content.contains(BEGIN) {
        return Ok(());
    }
    let (rest, _) = strip_block(&content);
    write_hosts(&rest)?;
    flush_dns();
    Ok(())
}

pub fn clear_silently() {
    let _ = clear_block();
}

#[cfg(windows)]
fn current_user_sid() -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("whoami")
        .args(["/user", "/fo", "csv", "/nh"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    // Ausgabe: "RECHNER\name","S-1-5-21-…"
    text.split(',')
        .map(|s| s.trim().trim_matches('"').to_string())
        .find(|s| s.starts_with("S-1-"))
        .filter(|s| s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
        .ok_or_else(|| "Benutzerkennung (SID) konnte nicht ermittelt werden.".to_string())
}

/// Base64 für PowerShells `-EncodedCommand` (UTF-16LE), damit keine
/// Anführungszeichen maskiert werden müssen.
#[cfg_attr(not(windows), allow(dead_code))]
fn encode_powershell(script: &str) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(TABLE[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[cfg(windows)]
fn run_elevated_icacls(args: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let args = args.replace('\'', "''");
    let script = format!(
        "try {{ $p = Start-Process -FilePath 'icacls.exe' -ArgumentList '{args}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode }} catch {{ exit 1223 }}"
    );
    let status = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-EncodedCommand",
            &encode_powershell(&script),
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| e.to_string())?;
    match status.code() {
        Some(0) => Ok(()),
        Some(1223) => Err("Die Windows-Abfrage wurde abgebrochen.".into()),
        Some(code) => Err(format!("icacls ist mit Code {code} fehlgeschlagen.")),
        None => Err("icacls wurde unerwartet beendet.".into()),
    }
}

/// Einmalige Einrichtung: gibt dem eigenen Konto Schreibrecht auf die hosts-Datei.
#[tauri::command]
pub async fn blocker_setup() -> Result<bool, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| {
            let sid = current_user_sid()?;
            let path = hosts_path().to_string_lossy().to_string();
            run_elevated_icacls(&format!("\"{path}\" /grant *{sid}:(M)"))?;
            Ok(is_writable())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        Err("Die automatische Einrichtung gibt es nur unter Windows.".into())
    }
}

/// Nimmt die Schreibberechtigung wieder zurück.
#[tauri::command]
pub async fn blocker_teardown() -> Result<bool, String> {
    let _ = tauri::async_runtime::spawn_blocking(clear_block).await;
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| {
            let sid = current_user_sid()?;
            let path = hosts_path().to_string_lossy().to_string();
            run_elevated_icacls(&format!("\"{path}\" /remove:g *{sid}"))?;
            Ok(!is_writable())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        Err("Die automatische Einrichtung gibt es nur unter Windows.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_domains() {
        assert_eq!(normalize_domain("https://www.YouTube.com/watch?v=1"), Some("youtube.com".into()));
        assert_eq!(normalize_domain("reddit.com"), Some("reddit.com".into()));
        assert_eq!(normalize_domain("evil\n127.0.0.1 bank.de"), None);
        assert_eq!(normalize_domain("localhost"), None);
        assert_eq!(normalize_domain("-bad.com"), None);
    }

    #[test]
    fn encodes_powershell_commands() {
        // "ab" in UTF-16LE = 61 00 62 00 → YQBiAA==
        assert_eq!(encode_powershell("ab"), "YQBiAA==");
        assert_eq!(encode_powershell("exit 0"), "ZQB4AGkAdAAgADAA");
    }

    #[test]
    fn strips_existing_block() {
        let content = format!(
            "127.0.0.1 localhost\r\n\r\n{BEGIN}\r\n0.0.0.0 youtube.com\r\n:: youtube.com\r\n0.0.0.0 www.youtube.com\r\n{END}\r\n"
        );
        let (rest, blocked) = strip_block(&content);
        assert_eq!(rest, "127.0.0.1 localhost\r\n");
        assert_eq!(blocked, vec!["youtube.com".to_string()]);
    }
}
