// Unlink desktop app — Tauri shell.
//
// What this does:
//   1. On launch, SPAWNS the Unlink privacy helper as a child process
//      (`node <repo>/helper/helper.mjs`) and keeps the handle.
//   2. Opens the window, which loads the dashboard UI (app/ui/*). The UI polls
//      the helper's local control API (127.0.0.1:18545/__unlink/status).
//   3. On exit, KILLS the helper so nothing is left running.
//
// The helper is run with the PASSTHROUGH specifier for now (the EF tor-js
// gateway is down — see CLAUDE.md / evidence.md E11). Swap the two env vars
// below for the real tor-js specifier + gateways once the gateway is back.
//
// Note: in `tauri dev` the helper is resolved from the source tree via
// CARGO_MANIFEST_DIR. A bundled release would ship the helper as a Tauri
// sidecar/resource instead (see app/README.md); set UNLINK_HELPER to override.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

/// Holds the spawned helper process so we can kill it on exit.
struct HelperProc(Mutex<Option<Child>>);

/// Absolute path to the helper entrypoint.
/// Override with UNLINK_HELPER; otherwise resolve it relative to this crate
/// (app/src-tauri -> ../../helper/helper.mjs).
fn helper_path() -> PathBuf {
    if let Ok(p) = std::env::var("UNLINK_HELPER") {
        return PathBuf::from(p);
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest.join("../../helper/helper.mjs")
}

/// Spawn `node helper.mjs` with the passthrough environment.
fn spawn_helper() -> std::io::Result<Child> {
    let helper = helper_path();
    let dir = helper.parent().map(PathBuf::from);
    let mut cmd = Command::new("node");
    cmd.arg(&helper)
        // Passthrough: exercises all the plumbing with no privacy while the
        // EF tor-js gateway is down. Replace with the real specifier + gateways
        // to route over Tor.
        .env("HELPER_SPECIFIER", "0x4fd77be300f31c5fe6ab266d35d27750a3478d27")
        .env("HELPER_GATEWAYS", "[]");
    if let Some(d) = dir {
        cmd.current_dir(d);
    }
    eprintln!("[unlink] spawning helper: node {}", helper.display());
    cmd.spawn()
}

fn kill_helper(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<HelperProc>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
                eprintln!("[unlink] stopping helper (pid {})", child.id());
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn main() {
    let app = tauri::Builder::default()
        .manage(HelperProc(Mutex::new(None)))
        .setup(|app| {
            match spawn_helper() {
                Ok(child) => {
                    *app.state::<HelperProc>().0.lock().unwrap() = Some(child);
                }
                Err(e) => {
                    // Surface the failure; the UI will show "Engine not running"
                    // and JSON-RPC will fail visibly — never a silent fallback.
                    eprintln!("[unlink] failed to spawn helper: {e}");
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Unlink");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            kill_helper(handle);
        }
    });
}
