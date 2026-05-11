use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_COPIED_FILE_BYTES: u64 = 8 * 1024 * 1024;
const IGNORED_DIR_NAMES: [&str; 11] = [
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    "coverage",
    ".cache",
    "venv",
    ".venv",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePrepareResult {
    pub sandbox_root: String,
    pub workspace_root: String,
    pub copied_files: u64,
    pub skipped_files: u64,
    pub skipped_dirs: Vec<String>,
}

#[derive(Default)]
struct CopyStats {
    copied_files: u64,
    skipped_files: u64,
    skipped_dirs: HashSet<String>,
}

pub fn sandbox_root(app_data_dir: &Path, sandbox_id: &str) -> PathBuf {
    app_data_dir.join("worker_sandboxes").join(sandbox_id)
}

pub fn prepare_workspace_snapshot(
    app_data_dir: &Path,
    sandbox_id: &str,
    source_root: &Path,
) -> Result<WorkspacePrepareResult, String> {
    let sandbox_root = sandbox_root(app_data_dir, sandbox_id);
    let workspace_root = sandbox_root.join("workspace");

    if sandbox_root.exists() {
        fs::remove_dir_all(&sandbox_root).map_err(|err| err.to_string())?;
    }

    fs::create_dir_all(&workspace_root).map_err(|err| err.to_string())?;

    let mut stats = CopyStats::default();
    copy_dir_recursive(source_root, &workspace_root, &mut stats)?;

    Ok(WorkspacePrepareResult {
        sandbox_root: sandbox_root.display().to_string(),
        workspace_root: workspace_root.display().to_string(),
        copied_files: stats.copied_files,
        skipped_files: stats.skipped_files,
        skipped_dirs: {
            let mut names = stats.skipped_dirs.into_iter().collect::<Vec<_>>();
            names.sort();
            names
        },
    })
}

pub fn destroy_workspace_snapshot(app_data_dir: &Path, sandbox_id: &str) -> Result<(), String> {
    let sandbox_root = sandbox_root(app_data_dir, sandbox_id);
    if sandbox_root.exists() {
        fs::remove_dir_all(sandbox_root).map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn copy_dir_recursive(
    source: &Path,
    destination: &Path,
    stats: &mut CopyStats,
) -> Result<(), String> {
    for entry in fs::read_dir(source).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let source_path = entry.path();
        let file_type = entry.file_type().map_err(|err| err.to_string())?;
        let target_path = destination.join(entry.file_name());

        if file_type.is_symlink() {
            stats.skipped_files += 1;
            continue;
        }

        if file_type.is_dir() {
            let dir_name = source_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string();
            if should_ignore_dir(&dir_name) {
                stats.skipped_dirs.insert(dir_name);
                continue;
            }

            fs::create_dir_all(&target_path).map_err(|err| err.to_string())?;
            copy_dir_recursive(&source_path, &target_path, stats)?;
            continue;
        }

        if file_type.is_file() {
            let metadata = entry.metadata().map_err(|err| err.to_string())?;
            if metadata.len() > MAX_COPIED_FILE_BYTES {
                stats.skipped_files += 1;
                continue;
            }
            fs::copy(&source_path, &target_path).map_err(|err| err.to_string())?;
            stats.copied_files += 1;
        }
    }

    Ok(())
}

fn should_ignore_dir(name: &str) -> bool {
    IGNORED_DIR_NAMES
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(name))
}
