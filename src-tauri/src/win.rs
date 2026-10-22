//! Windows-Hilfen über die Windows-API – ohne Umweg über PowerShell oder
//! Konsolenprogramme wie `whoami`. Solche Aufrufe (versteckt, kodiert,
//! mit Adminrechten) sehen für Virenscanner aus wie Schadsoftware.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, LocalFree, ERROR_CANCELLED, HANDLE};
use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetExitCodeProcess, OpenProcessToken, WaitForSingleObject, INFINITE,
};
use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

fn wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

/// Vollständiger Pfad zu einem Programm in `C:\Windows\System32`.
pub fn system32(program: &str) -> String {
    let root = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    root.join("System32").join(program).to_string_lossy().to_string()
}

/// Kennung (SID) des angemeldeten Benutzers, z. B. „S-1-5-21-…“.
pub fn current_user_sid() -> Result<String, String> {
    let fail = |what: &str| format!("Benutzerkennung (SID) nicht lesbar: {what} (Fehler {})", unsafe { GetLastError() });
    unsafe {
        let mut token: HANDLE = null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(fail("Token"));
        }
        let mut len = 0u32;
        GetTokenInformation(token, TokenUser, null_mut(), 0, &mut len);
        // als u64 anlegen, damit TOKEN_USER richtig ausgerichtet ist
        let mut buf = vec![0u64; (len as usize).div_ceil(8).max(1)];
        let ok = GetTokenInformation(token, TokenUser, buf.as_mut_ptr().cast(), len, &mut len);
        CloseHandle(token);
        if ok == 0 {
            return Err(fail("Tokeninformation"));
        }
        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut raw: *mut u16 = null_mut();
        if ConvertSidToStringSidW(user.User.Sid, &mut raw) == 0 || raw.is_null() {
            return Err(fail("Umwandlung"));
        }
        let mut n = 0usize;
        while *raw.add(n) != 0 {
            n += 1;
        }
        let sid = String::from_utf16_lossy(std::slice::from_raw_parts(raw, n));
        LocalFree(raw.cast());
        if sid.starts_with("S-1-") && sid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            Ok(sid)
        } else {
            Err("Benutzerkennung (SID) hat ein unerwartetes Format.".into())
        }
    }
}

/// Startet ein Programm mit Administratorrechten (Windows fragt nach) und
/// wartet auf das Ende. Liefert den Exit-Code des Programms.
pub fn run_elevated(program: &str, args: &str) -> Result<u32, String> {
    let verb = wide("runas");
    let file = wide(program);
    let params = wide(args);
    unsafe {
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = params.as_ptr();
        info.nShow = SW_HIDE;
        if ShellExecuteExW(&mut info) == 0 {
            let err = GetLastError();
            return Err(if err == ERROR_CANCELLED {
                "Die Windows-Abfrage wurde abgebrochen.".into()
            } else {
                format!("Das Programm konnte nicht gestartet werden (Fehler {err}).")
            });
        }
        if info.hProcess.is_null() {
            return Err("Das Programm wurde nicht gestartet.".into());
        }
        WaitForSingleObject(info.hProcess, INFINITE);
        let mut code = 0u32;
        let got = GetExitCodeProcess(info.hProcess, &mut code);
        CloseHandle(info.hProcess);
        if got == 0 {
            return Err("Ergebnis des Programms nicht lesbar.".into());
        }
        Ok(code)
    }
}
