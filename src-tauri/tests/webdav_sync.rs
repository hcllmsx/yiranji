// WebDAV 同步的端到端验证（配合 scripts/mock-webdav.cjs 使用）
// 运行前需先启动本地模拟服务器，并设置环境变量 MOCK_DAV=http://127.0.0.1:18080/dav
//
// 覆盖：首次上传 / 重复上传跳过 / 媒体变更重传 / 子目录媒体（头像）/ 另一台电脑拉取 /
//       删除照片后不再回传 / 云端元信息 / 密码错误。

use std::fs;
use std::path::{Path, PathBuf};

use app_lib::{project_file, webdav};

const USER: &str = "user";
const PASS: &str = "pass";

fn mock_dav() -> Option<String> {
    std::env::var("MOCK_DAV").ok()
}

fn workspace(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("yiranji-sync-{}-{}", tag, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("media")).unwrap();
    dir
}

fn project_json(dir: &Path, updated_at: &str, media: &[&str]) -> String {
    let base = dir.to_string_lossy().replace('\\', "/");
    let photos: Vec<String> = media
        .iter()
        .map(|name| format!("{{\"path\":\"{}/media/{}\"}}", base, name))
        .collect();
    format!(
        "{{\"meta\":{{\"updatedAt\":\"{}\",\"familyName\":\"测试家谱\"}},\"persons\":{{\"p1\":{{\"id\":\"p1\",\"photos\":[{}]}}}}}}",
        updated_at,
        photos.join(",")
    )
}

fn write_project(dir: &Path, updated_at: &str, media: &[&str]) {
    project_file::write_workspace_project(dir, &project_json(dir, updated_at, media)).unwrap();
}

fn write_media(dir: &Path, name: &str, size: usize) {
    let path = dir
        .join("media")
        .join(name.replace('/', std::path::MAIN_SEPARATOR_STR));
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, vec![b'x'; size]).unwrap();
}

#[test]
fn webdav_sync_roundtrip() {
    let Some(server) = mock_dav() else {
        eprintln!("未设置 MOCK_DAV，跳过");
        return;
    };

    tauri::async_runtime::block_on(async move {
        let remote_dir = format!("yiranji/test-{}", std::process::id());

        // ---------- 1. 首次上传（含子目录头像，两个同名 cropped.jpg） ----------
        let ws1 = workspace("a");
        let media = ["a.jpg", "avatar_1/cropped.jpg", "avatar_2/cropped.jpg"];
        write_project(&ws1, "2026-10-19T06:00:00.000Z", &media);
        write_media(&ws1, "a.jpg", 1000);
        write_media(&ws1, "avatar_1/cropped.jpg", 2000);
        write_media(&ws1, "avatar_2/cropped.jpg", 3000);

        let path =
            webdav::webdav_test(server.clone(), USER.into(), PASS.into(), remote_dir.clone())
                .await
                .expect("测试连接失败");
        println!("连接成功: {path}");

        let first = webdav::webdav_push(
            server.clone(),
            USER.into(),
            PASS.into(),
            remote_dir.clone(),
            ws1.to_string_lossy().into_owned(),
            Some("测试机A".into()),
        )
        .await
        .expect("首次上传失败");
        println!("首次上传: {:?}", first);
        assert_eq!(first.uploaded_media, 3, "首次应上传 3 个媒体（含子目录）");
        assert_eq!(first.revision, 1);
        assert!(!first.remote_existed);

        // ---------- 2. 重复上传应全部跳过（子目录也能被正确识别） ----------
        let second = webdav::webdav_push(
            server.clone(),
            USER.into(),
            PASS.into(),
            remote_dir.clone(),
            ws1.to_string_lossy().into_owned(),
            Some("测试机A".into()),
        )
        .await
        .expect("二次上传失败");
        println!("二次上传: {:?}", second);
        assert_eq!(second.uploaded_media, 0, "已存在的媒体不应重复上传");
        assert_eq!(second.skipped_media, 3);
        assert_eq!(second.revision, 2);
        assert!(second.remote_existed);

        // ---------- 3. 媒体内容变了（大小不同）应重传 ----------
        write_media(&ws1, "a.jpg", 1500);
        let third = webdav::webdav_push(
            server.clone(),
            USER.into(),
            PASS.into(),
            remote_dir.clone(),
            ws1.to_string_lossy().into_owned(),
            Some("测试机A".into()),
        )
        .await
        .expect("重传失败");
        println!("媒体变更后上传: {:?}", third);
        assert_eq!(third.uploaded_media, 1, "大小变化应触发重传");

        // ---------- 4. 另一台电脑拉取（含子目录） ----------
        let ws2 = workspace("b");
        write_project(&ws2, "2026-10-18T00:00:00.000Z", &[]);
        let pull = webdav::webdav_pull(
            server.clone(),
            USER.into(),
            PASS.into(),
            remote_dir.clone(),
            ws2.to_string_lossy().into_owned(),
        )
        .await
        .expect("拉取失败");
        println!("拉取: {:?}", pull);
        assert_eq!(pull.downloaded_media, 3, "应补齐 3 个媒体（含子目录）");
        assert_eq!(pull.remote.device, "测试机A");
        assert_eq!(pull.remote.revision, 3);
        assert!(ws2.join("media").join("a.jpg").is_file());
        assert!(ws2
            .join("media")
            .join("avatar_1")
            .join("cropped.jpg")
            .is_file());
        assert!(ws2
            .join("media")
            .join("avatar_2")
            .join("cropped.jpg")
            .is_file());
        assert_eq!(
            fs::metadata(ws2.join("media").join("a.jpg")).unwrap().len(),
            1500,
            "拉到的应是最新版本"
        );
        assert_eq!(
            fs::metadata(ws2.join("media").join("avatar_2").join("cropped.jpg"))
                .unwrap()
                .len(),
            3000,
            "同名文件不应互相覆盖"
        );

        let pulled =
            project_file::read_project(&ws2.join(project_file::PROJECT_FILE_NAME)).unwrap();
        assert!(pulled.contains("2026-10-19T06:00:00.000Z"));
        assert!(!pull.backup_path.is_empty(), "覆盖前应备份本地 project.yrp");

        // 旧本地 JSON 在云端覆盖前同样必须备份并校验，成功后才可移除。
        let legacy_ws = workspace("legacy");
        let legacy_source = project_json(&legacy_ws, "2026-10-18T00:00:00.000Z", &[]);
        fs::write(
            legacy_ws.join(project_file::LEGACY_PROJECT_FILE_NAME),
            &legacy_source,
        )
        .unwrap();
        let legacy_pull = webdav::webdav_pull(
            server.clone(),
            USER.into(),
            PASS.into(),
            remote_dir.clone(),
            legacy_ws.to_string_lossy().into_owned(),
        )
        .await
        .expect("旧本地工作区拉取失败");
        assert!(legacy_pull.backup_path.ends_with(".json"));
        assert_eq!(
            fs::read_to_string(&legacy_pull.backup_path).unwrap(),
            legacy_source
        );
        assert!(!legacy_ws
            .join(project_file::LEGACY_PROJECT_FILE_NAME)
            .exists());
        assert!(legacy_ws.join(project_file::PROJECT_FILE_NAME).is_file());

        // YRP 与遗留 JSON 同时存在时，两份本地数据都要保留备份。
        let dual_legacy_source = project_json(&legacy_ws, "2026-10-17T00:00:00.000Z", &[]);
        fs::write(
            legacy_ws.join(project_file::LEGACY_PROJECT_FILE_NAME),
            &dual_legacy_source,
        )
        .unwrap();
        let dual_pull = webdav::webdav_pull(
            server.clone(),
            USER.into(),
            PASS.into(),
            remote_dir.clone(),
            legacy_ws.to_string_lossy().into_owned(),
        )
        .await
        .expect("双格式工作区拉取失败");
        assert!(dual_pull.backup_path.ends_with(".yrp"));
        let dual_json_backup = dual_pull.backup_path.replace(".yrp", ".json");
        assert_eq!(
            fs::read_to_string(dual_json_backup).unwrap(),
            dual_legacy_source
        );

        // ---------- 5. 删除的照片不应再被拉回 ----------
        let kept = ["a.jpg", "avatar_1/cropped.jpg"];
        write_project(&ws1, "2026-10-19T07:00:00.000Z", &kept);
        fs::remove_file(ws1.join("media").join("avatar_2").join("cropped.jpg")).unwrap();
        let fourth = webdav::webdav_push(
            server.clone(),
            USER.into(),
            PASS.into(),
            remote_dir.clone(),
            ws1.to_string_lossy().into_owned(),
            Some("测试机A".into()),
        )
        .await
        .expect("删除后上传失败");
        println!("删除后上传: {:?}", fourth);
        assert_eq!(fourth.uploaded_media, 0, "剩余的媒体云端都已存在");

        let ws3 = workspace("c");
        write_project(&ws3, "2026-10-18T00:00:00.000Z", &[]);
        let pull3 = webdav::webdav_pull(
            server.clone(),
            USER.into(),
            PASS.into(),
            remote_dir.clone(),
            ws3.to_string_lossy().into_owned(),
        )
        .await
        .expect("二次拉取失败");
        println!("删除后拉取: {:?}", pull3);
        assert_eq!(pull3.downloaded_media, 2, "云端残留的已删照片不该再被下载");
        assert!(!ws3
            .join("media")
            .join("avatar_2")
            .join("cropped.jpg")
            .exists());

        // ---------- 6. 元信息读取 ----------
        let meta = webdav::webdav_remote_meta(
            server.clone(),
            USER.into(),
            PASS.into(),
            remote_dir.clone(),
        )
        .await
        .expect("读取云端元信息失败")
        .expect("云端元信息不应为空");
        assert_eq!(meta.project_updated_at, "2026-10-19T07:00:00.000Z");

        // ---------- 7. 密码错误应报错 ----------
        let bad = webdav::webdav_remote_meta(
            server.clone(),
            USER.into(),
            "wrong".into(),
            remote_dir.clone(),
        )
        .await;
        assert!(bad.is_err(), "错误密码应返回错误");

        // ---------- 8. 云端家谱列表（换电脑恢复用） ----------
        let list = webdav::webdav_list_projects(
            server.clone(),
            USER.into(),
            PASS.into(),
            "yiranji".into(),
        )
        .await
        .expect("读取云端家谱列表失败");
        println!("云端家谱列表: {} 条", list.len());
        let expected_dir = format!("test-{}", std::process::id());
        let mine = list
            .iter()
            .find(|p| p.dir == expected_dir)
            .expect("列表中应包含本次测试的家谱");
        assert_eq!(mine.family_name, "测试家谱");
        assert_eq!(mine.revision, 4);
        assert_eq!(mine.media_count, 2);

        println!("全部断言通过");
    });
}
