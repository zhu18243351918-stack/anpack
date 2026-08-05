use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
};

#[derive(Default)]
struct RenderProcesses(Mutex<HashMap<String, u32>>);

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

fn blender_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let blender = resources
        .join("resources")
        .join("blender")
        .join("blender.exe");
    let script = resources.join("resources").join("blender_render.py");
    if !blender.exists() {
        return Err(format!("未找到内置 Blender 运行时：{}", blender.display()));
    }
    if !script.exists() {
        return Err(format!("未找到 Cycles 渲染脚本：{}", script.display()));
    }
    Ok((blender, script))
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
    let mut command = Command::new(blender);
    command
        .args(["--background", "--factory-startup", "--python"])
        .arg(script)
        .args(["--", "--job"])
        .arg(&job_path)
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
            start_cycles_render,
            cancel_cycles_render
        ])
        .run(tauri::generate_context!())
        .expect("error while running Anpack");
}
