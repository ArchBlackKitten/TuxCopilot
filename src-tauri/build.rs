// What TuxCopilot knows about where it was built from, for "Is this the real TuxCopilot?"
// (original.rs): the commit, and whether it came from a release tarball or a git folder.
// A release tarball (git archive) has the commit written into build-info by git itself
// (export-subst); a git folder still says $Format…$ there, and git is asked instead.
// Nothing here can fail the build: what can't be found is left empty.

use std::process::Command;

fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).env("GIT_OPTIONAL_LOCKS", "0").output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn main() {
    let info = std::fs::read_to_string("build-info").unwrap_or_default();
    let field = |k: &str| info.lines().find_map(|l| l.strip_prefix(&format!("{k}="))).unwrap_or("").to_string();
    let (from, commit, refs) = if !field("commit").is_empty() && !field("commit").contains("$Format") {
        ("release", field("commit"), field("refs"))
    } else if let Some(c) = git(&["rev-parse", "HEAD"]) {
        ("git", c, String::new())
    } else {
        ("unknown", String::new(), String::new())
    };
    println!("cargo:rustc-env=TUX_BUILT_FROM={from}");
    println!("cargo:rustc-env=TUX_COMMIT={commit}");
    println!("cargo:rustc-env=TUX_REFS={}", refs.replace('\n', " "));
    // the folder it was built in, so "Changed on this computer" can look there later — but not in
    // a package (the PKGBUILDs set TUXCOPILOT_PACKAGE): makepkg's folder is gone after the build,
    // and its path would carry the name of whoever built it
    println!("cargo:rerun-if-env-changed=TUXCOPILOT_PACKAGE");
    let source = match std::env::var_os("TUXCOPILOT_PACKAGE") {
        Some(_) => String::new(),
        None => std::env::var("CARGO_MANIFEST_DIR").ok().and_then(|d| std::path::Path::new(&d).parent().map(|p| p.to_string_lossy().into_owned())).unwrap_or_default(),
    };
    println!("cargo:rustc-env=TUX_SOURCE_DIR={source}");
    // the release key's public half, built in: a release tag is checked against it alone
    let fpr = std::fs::read_to_string("../keys/release-key").unwrap_or_default().trim().to_string();
    let key = std::fs::read_to_string(format!("../keys/pgp/{fpr}.asc")).unwrap_or_default();
    let out = std::env::var("OUT_DIR").expect("cargo sets OUT_DIR");
    std::fs::write(format!("{out}/release-key.asc"), key).expect("OUT_DIR is writable");
    println!("cargo:rustc-env=TUX_RELEASE_KEY={fpr}");
    println!("cargo:rerun-if-changed=../keys");
    println!("cargo:rerun-if-changed=build-info");
    // only paths that exist: cargo reruns this every build for one that doesn't
    for p in ["../.git/HEAD", "../.git/refs/heads"] {
        if from == "git" && std::path::Path::new(p).exists() {
            println!("cargo:rerun-if-changed={p}");
        }
    }
    tauri_build::build()
}
