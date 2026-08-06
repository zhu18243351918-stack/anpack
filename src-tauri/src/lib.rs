use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::Write,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};

#[derive(Default)]
struct RenderProcesses(Mutex<HashMap<String, u32>>);

#[derive(Default)]
struct RuntimeInstallState(Mutex<Option<Arc<AtomicBool>>>);

const BLENDER_VERSION: &str = "4.5.12";
const BLENDER_ARCHIVE_SHA256: &str =
    "317ef64e7a2c3cc79ec810c766ae9828aff865bea78039dc695b3f1118c34b4f";
const BLENDER_ARCHIVE_URLS: [&str; 2] = [
    "https://zhu18243351918-stack.github.io/anpack/downloads/Anpack_Blender_4.5.12_windows_x64.zip",
    "https://download.blender.org/release/Blender4.5/blender-4.5.12-windows-x64.zip",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderJobFile {
    id: String,
    output_path: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RenderProgress {
    job_id: String,
    stage: String,
    progress: f64,
    message: String,
    device: Option<String>,
    fallback: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RenderResult {
    output_path: String,
    device: String,
    fallback: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    installed: bool,
    version: String,
    source: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RuntimeProgress {
    stage: String,
    progress: f64,
    message: String,
    downloaded: u64,
    total: Option<u64>,
}

fn runtime_complete(directory: &Path) -> bool {
    directory.join("blender.exe").is_file()
        && std::fs::read_dir(directory)
            .ok()
            .map(|entries| {
                entries.flatten().any(|entry| {
                    entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
                        && entry
                            .file_name()
                            .to_string_lossy()
                            .chars()
                            .next()
                            .map(|character| character.is_ascii_digit())
                            .unwrap_or(false)
                        && entry.path().join("python").join("lib").is_dir()
                })
            })
            .unwrap_or(false)
}

fn downloaded_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| {
            path.join("cycles-runtime")
                .join(format!("blender-{BLENDER_VERSION}"))
        })
        .map_err(|error| error.to_string())
}

fn bundled_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    Ok(resources.join("resources").join("blender"))
}

fn blender_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let script = resources.join("resources").join("blender_render.py");
    if !script.exists() {
        return Err(format!("未找到 Cycles 渲染脚本：{}", script.display()));
    }
    let downloaded = downloaded_runtime_dir(app)?;
    if runtime_complete(&downloaded) {
        return Ok((downloaded.join("blender.exe"), script));
    }
    let bundled = bundled_runtime_dir(app)?;
    if runtime_complete(&bundled) {
        return Ok((bundled.join("blender.exe"), script));
    }
    Err("尚未安装 Blender Cycles 组件，首次渲染时将自动下载".into())
}

#[tauri::command]
fn cycles_runtime_status(app: AppHandle) -> Result<RuntimeStatus, String> {
    let downloaded = downloaded_runtime_dir(&app)?;
    if runtime_complete(&downloaded) {
        return Ok(RuntimeStatus {
            installed: true,
            version: BLENDER_VERSION.into(),
            source: Some("downloaded".into()),
        });
    }
    let bundled = bundled_runtime_dir(&app)?;
    Ok(RuntimeStatus {
        installed: runtime_complete(&bundled),
        version: BLENDER_VERSION.into(),
        source: runtime_complete(&bundled).then(|| "bundled".into()),
    })
}

fn emit_runtime_progress(
    app: &AppHandle,
    stage: &str,
    progress: f64,
    message: impl Into<String>,
    downloaded: u64,
    total: Option<u64>,
) {
    let _ = app.emit(
        "cycles-runtime-progress",
        RuntimeProgress {
            stage: stage.into(),
            progress,
            message: message.into(),
            downloaded,
            total,
        },
    );
}

fn extract_runtime_archive(
    archive_path: &Path,
    staging: &Path,
    final_dir: &Path,
    cancel: &AtomicBool,
    app: &AppHandle,
) -> Result<(), String> {
    if staging.exists() {
        std::fs::remove_dir_all(staging).map_err(|error| error.to_string())?;
    }
    std::fs::create_dir_all(staging).map_err(|error| error.to_string())?;
    let file = std::fs::File::open(archive_path).map_err(|error| error.to_string())?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|error| format!("无法读取 Blender 压缩包：{error}"))?;
    let count = archive.len().max(1);
    for index in 0..archive.len() {
        if cancel.load(Ordering::Relaxed) {
            return Err("Cycles 组件下载已取消".into());
        }
        let mut item = archive.by_index(index).map_err(|error| error.to_string())?;
        let relative = item
            .enclosed_name()
            .ok_or_else(|| "Blender 压缩包包含不安全路径".to_string())?;
        let output = staging.join(relative);
        if item.is_dir() {
            std::fs::create_dir_all(&output).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = output.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut target = std::fs::File::create(&output).map_err(|error| error.to_string())?;
            std::io::copy(&mut item, &mut target).map_err(|error| error.to_string())?;
            target.flush().map_err(|error| error.to_string())?;
        }
        if index % 80 == 0 {
            emit_runtime_progress(
                app,
                "extracting",
                82.0 + index as f64 / count as f64 * 16.0,
                "正在安装 Blender Cycles 组件",
                0,
                None,
            );
        }
    }
    let extracted = std::fs::read_dir(staging)
        .map_err(|error| error.to_string())?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| runtime_complete(path))
        .ok_or_else(|| "下载的 Blender 运行时目录不完整".to_string())?;
    if final_dir.exists() {
        std::fs::remove_dir_all(final_dir).map_err(|error| error.to_string())?;
    }
    if let Some(parent) = final_dir.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::rename(&extracted, final_dir)
        .map_err(|error| format!("无法安装 Cycles 组件：{error}"))?;
    let _ = std::fs::remove_dir_all(staging);
    Ok(())
}

async fn download_runtime_archive(
    app: &AppHandle,
    archive_path: &Path,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("Anpack Cycles Runtime Installer")
        .build()
        .map_err(|error| error.to_string())?;
    let mut last_error = String::new();
    for url in BLENDER_ARCHIVE_URLS {
        if cancel.load(Ordering::Relaxed) {
            return Err("Cycles 组件下载已取消".into());
        }
        emit_runtime_progress(
            app,
            "connecting",
            1.0,
            "正在连接 Cycles 组件下载源",
            0,
            None,
        );
        let response = match client.get(url).send().await {
            Ok(response) if response.status().is_success() => response,
            Ok(response) => {
                last_error = format!("下载源返回状态码 {}", response.status());
                continue;
            }
            Err(error) => {
                last_error = error.to_string();
                continue;
            }
        };
        let total = response.content_length();
        let mut stream = response.bytes_stream();
        let mut file = tokio::fs::File::create(archive_path)
            .await
            .map_err(|error| error.to_string())?;
        let mut downloaded = 0u64;
        let mut hasher = Sha256::new();
        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::Relaxed) {
                let _ = tokio::fs::remove_file(archive_path).await;
                return Err("Cycles 组件下载已取消".into());
            }
            let chunk = chunk.map_err(|error| error.to_string())?;
            file.write_all(&chunk)
                .await
                .map_err(|error| error.to_string())?;
            hasher.update(&chunk);
            downloaded += chunk.len() as u64;
            let progress = total
                .map(|size| 2.0 + downloaded as f64 / size.max(1) as f64 * 78.0)
                .unwrap_or(25.0);
            emit_runtime_progress(
                app,
                "downloading",
                progress.min(80.0),
                format!(
                    "正在下载 Blender Cycles · {:.1} MB",
                    downloaded as f64 / 1_048_576.0
                ),
                downloaded,
                total,
            );
        }
        file.flush().await.map_err(|error| error.to_string())?;
        let actual = format!("{:x}", hasher.finalize());
        if actual == BLENDER_ARCHIVE_SHA256 {
            return Ok(());
        }
        last_error = format!("Cycles 组件校验失败：{actual}");
        let _ = tokio::fs::remove_file(archive_path).await;
    }
    Err(format!("无法下载 Blender Cycles 组件：{last_error}"))
}

#[tauri::command]
async fn install_cycles_runtime(
    app: AppHandle,
    state: State<'_, RuntimeInstallState>,
) -> Result<RuntimeStatus, String> {
    let current = cycles_runtime_status(app.clone())?;
    if current.installed {
        return Ok(current);
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut active = state
            .0
            .lock()
            .map_err(|_| "Cycles 下载状态已损坏".to_string())?;
        if active.is_some() {
            return Err("Cycles 组件正在下载".into());
        }
        *active = Some(cancel.clone());
    }
    let result = async {
        let cache = app
            .path()
            .app_cache_dir()
            .map_err(|error| error.to_string())?
            .join("cycles-runtime");
        tokio::fs::create_dir_all(&cache)
            .await
            .map_err(|error| error.to_string())?;
        let archive_path = cache.join(format!("blender-{BLENDER_VERSION}.zip.part"));
        download_runtime_archive(&app, &archive_path, &cancel).await?;
        emit_runtime_progress(&app, "verifying", 81.0, "Cycles 组件校验完成", 0, None);
        let final_dir = downloaded_runtime_dir(&app)?;
        let staging = final_dir
            .parent()
            .ok_or_else(|| "无法创建 Cycles 组件目录".to_string())?
            .join(format!("blender-{BLENDER_VERSION}.partial"));
        let archive_for_extract = archive_path.clone();
        let app_for_extract = app.clone();
        let cancel_for_extract = cancel.clone();
        let final_for_extract = final_dir.clone();
        let staging_for_extract = staging.clone();
        tokio::task::spawn_blocking(move || {
            extract_runtime_archive(
                &archive_for_extract,
                &staging_for_extract,
                &final_for_extract,
                &cancel_for_extract,
                &app_for_extract,
            )
        })
        .await
        .map_err(|error| error.to_string())??;
        let _ = tokio::fs::remove_file(&archive_path).await;
        emit_runtime_progress(&app, "done", 100.0, "Blender Cycles 组件安装完成", 0, None);
        cycles_runtime_status(app.clone())
    }
    .await;
    if let Ok(mut active) = state.0.lock() {
        *active = None;
    }
    result
}

#[tauri::command]
fn cancel_cycles_runtime_install(state: State<'_, RuntimeInstallState>) -> Result<(), String> {
    if let Some(cancel) = state
        .0
        .lock()
        .map_err(|_| "Cycles 下载状态已损坏".to_string())?
        .as_ref()
    {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
async fn start_cycles_render(
    app: AppHandle,
    state: State<'_, RenderProcesses>,
    job_path: String,
) -> Result<RenderResult, String> {
    let job_text =
        std::fs::read_to_string(&job_path).map_err(|error| format!("无法读取渲染任务：{error}"))?;
    let job: RenderJobFile =
        serde_json::from_str(&job_text).map_err(|error| format!("渲染任务格式错误：{error}"))?;
    let (blender, script) = blender_paths(&app)?;
    let initial = RenderProgress {
        job_id: job.id.clone(),
        stage: "building".into(),
        progress: 8.0,
        message: "正在启动 Blender Cycles".into(),
        device: None,
        fallback: None,
    };
    let _ = app.emit("cycles-progress", initial);
    let mut command = Command::new(&blender);
    command
        .args(["--background", "--factory-startup", "--python"])
        .arg(script)
        .args(["--", "--job"])
        .arg(&job_path)
        .current_dir(
            blender
                .parent()
                .ok_or_else(|| "无法定位 Blender 运行目录".to_string())?,
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 Blender：{error}"))?;
    let pid = child
        .id()
        .ok_or_else(|| "无法获取 Blender 进程编号".to_string())?;
    state
        .0
        .lock()
        .map_err(|_| "渲染进程状态已损坏".to_string())?
        .insert(job.id.clone(), pid);
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 Blender 输出".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 Blender 错误输出".to_string())?;
    let app_stdout = app.clone();
    let job_id = job.id.clone();
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        let mut device = "CPU".to_string();
        let mut fallback = None;
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(json) = line.strip_prefix("ANPACK_PROGRESS ") {
                if let Ok(mut progress) = serde_json::from_str::<RenderProgress>(json) {
                    progress.job_id = job_id.clone();
                    if let Some(value) = &progress.device {
                        device = value.clone();
                    }
                    if progress.fallback.is_some() {
                        fallback = progress.fallback.clone();
                    }
                    let _ = app_stdout.emit("cycles-progress", progress);
                }
            }
        }
        (device, fallback)
    });
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut tail = Vec::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                tail.push(line);
                if tail.len() > 20 {
                    tail.remove(0);
                }
            }
        }
        tail.join("\n")
    });
    let status = child
        .wait()
        .await
        .map_err(|error| format!("Cycles 渲染进程异常：{error}"))?;
    state
        .0
        .lock()
        .map_err(|_| "渲染进程状态已损坏".to_string())?
        .remove(&job.id);
    let (device, fallback) = stdout_task
        .await
        .unwrap_or_else(|_| ("CPU".into(), Some("无法读取设备状态".into())));
    let errors = stderr_task.await.unwrap_or_default();
    if !status.success() {
        return Err(if errors.is_empty() {
            format!("Blender 退出代码：{status}")
        } else {
            errors
        });
    }
    if !Path::new(&job.output_path).exists() {
        return Err("Blender 已结束，但没有生成输出文件".into());
    }
    Ok(RenderResult {
        output_path: job.output_path,
        device,
        fallback,
    })
}

#[tauri::command]
async fn cancel_cycles_render(
    state: State<'_, RenderProcesses>,
    job_id: String,
) -> Result<(), String> {
    let pid = state
        .0
        .lock()
        .map_err(|_| "渲染进程状态已损坏".to_string())?
        .remove(&job_id);
    if let Some(pid) = pid {
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(0x08000000)
                .output()
                .await;
        }
        #[cfg(not(windows))]
        {
            let _ = Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .output()
                .await;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RenderProcesses::default())
        .manage(RuntimeInstallState::default())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let urls: Vec<String> = argv
                .into_iter()
                .filter(|arg| arg.starts_with("anpack://"))
                .collect();
            if !urls.is_empty() {
                let _ = app.emit("deep-link://new-url", urls);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_stronghold::Builder::new(|password| password.as_bytes().to_vec()).build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            cycles_runtime_status,
            install_cycles_runtime,
            cancel_cycles_runtime_install,
            start_cycles_render,
            cancel_cycles_render
        ])
        .run(tauri::generate_context!())
        .expect("error while running Anpack");
}
