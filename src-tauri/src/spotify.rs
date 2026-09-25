//! Spotify-Anmeldung (Authorization Code mit PKCE).
//!
//! Die Oberfläche erzeugt Code-Verifier/-Challenge und die Anmelde-URL. Das
//! Backend öffnet den Browser, nimmt die Weiterleitung auf
//! `http://127.0.0.1:<port>/callback` entgegen und tauscht den Code gegen
//! Tokens. Ein Client-Secret wird dabei nicht benötigt.

use std::collections::HashMap;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

fn page(title: &str, text: &str) -> String {
    let body = format!(
        "<!doctype html><html lang=\"de\"><head><meta charset=\"utf-8\"><title>Fokus</title>\
         <style>body{{font-family:'Segoe UI',system-ui,sans-serif;background:#f4f2ec;color:#2e3430;\
         display:grid;place-items:center;height:100vh;margin:0}}main{{text-align:center}}\
         h1{{font-weight:500;color:#5f7f6a}}</style></head><body><main><h1>{title}</h1><p>{text}</p></main></body></html>"
    );
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

/// Öffnet die Spotify-Anmeldung im Browser und wartet auf den Rückruf.
/// Liefert den Autorisierungscode.
#[tauri::command]
pub async fn spotify_authorize(app: AppHandle, auth_url: String, port: u16, state: String) -> Result<String, String> {
    if !auth_url.starts_with("https://accounts.spotify.com/") {
        return Err("Ungültige Anmelde-URL".into());
    }
    let listener = TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("Port {port} ist belegt ({e}). Ist Fokus zweimal geöffnet?"))?;
    app.opener().open_url(&auth_url, None::<&str>).map_err(|e| e.to_string())?;

    match tokio::time::timeout(LOGIN_TIMEOUT, accept_callback(listener, state)).await {
        Ok(result) => result,
        Err(_) => Err("Zeitüberschreitung bei der Anmeldung.".into()),
    }
}

async fn accept_callback(listener: TcpListener, state: String) -> Result<String, String> {
    loop {
        let (mut socket, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 8192];
        let n = socket.read(&mut buf).await.map_err(|e| e.to_string())?;
        let request = String::from_utf8_lossy(&buf[..n]).to_string();
        let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
        if !path.starts_with("/callback") {
            // z. B. favicon.ico – ignorieren und weiter warten
            let _ = socket.write_all(page("Fokus", "").as_bytes()).await;
            continue;
        }
        let parsed = url::Url::parse(&format!("http://127.0.0.1{path}")).map_err(|e| e.to_string())?;
        let params: HashMap<String, String> = parsed.query_pairs().into_owned().collect();

        let outcome = if params.get("state") != Some(&state) {
            Err("Die Anmeldung konnte nicht bestätigt werden (state stimmt nicht).".to_string())
        } else if let Some(error) = params.get("error") {
            Err(if error == "access_denied" {
                "Die Anmeldung wurde abgebrochen.".to_string()
            } else {
                format!("Spotify meldet: {error}")
            })
        } else if let Some(code) = params.get("code") {
            Ok(code.clone())
        } else {
            Err("Kein Code von Spotify erhalten.".to_string())
        };

        let html = match &outcome {
            Ok(_) => page("Mit Spotify verbunden", "Du kannst dieses Fenster schließen und zu Fokus zurückkehren."),
            Err(e) => page("Anmeldung fehlgeschlagen", e),
        };
        let _ = socket.write_all(html.as_bytes()).await;
        let _ = socket.shutdown().await;
        return outcome;
    }
}

/// Tauscht Code bzw. Refresh-Token gegen neue Tokens. Liefert die JSON-Antwort.
#[tauri::command]
pub async fn spotify_token(params: HashMap<String, String>) -> Result<String, String> {
    let client = reqwest::Client::new();
    let res = client
        .post(TOKEN_URL)
        .form(&params)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("Keine Verbindung zu Spotify: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if status.is_success() {
        Ok(text)
    } else {
        Err(format!("Spotify-Anmeldung fehlgeschlagen ({status}): {text}"))
    }
}
