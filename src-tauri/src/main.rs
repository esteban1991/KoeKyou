#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{process::Command, time::{Duration, Instant}, net::TcpStream};
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let root = if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
            } else {
                app.path().resource_dir()?.join("docker")
            };
            let mut command = Command::new("docker");
            command.current_dir(root).args(["compose", "up", "-d", "--build", "--wait", "--wait-timeout", "120"]);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let status = command.status()?;
            if !status.success() {
                return Err(std::io::Error::other("No se pudo iniciar Docker Compose. Abre Docker Desktop y vuelve a intentarlo.").into());
            }
            let start = Instant::now();
            while TcpStream::connect("127.0.0.1:8000").is_err() {
                if start.elapsed() > Duration::from_secs(30) {
                    return Err(std::io::Error::other("El motor de audio no respondió.").into());
                }
                std::thread::sleep(Duration::from_millis(250));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar VoiceMaster Pro");
}
