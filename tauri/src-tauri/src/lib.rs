use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // WebView2 的网络盘用户数据目录会报 os error 5；固定放到本机 AppData。
            let data_dir = app.path().app_local_data_dir()?.join("WebView2");
            std::fs::create_dir_all(&data_dir)?;

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("墨阅")
                .inner_size(1440.0, 960.0)
                .min_inner_size(1024.0, 700.0)
                .resizable(true)
                .disable_drag_drop_handler()
                .data_directory(data_dir)
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running 墨阅");
}
