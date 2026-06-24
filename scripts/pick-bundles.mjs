// 从 `artifact-paths`(换行分隔的 glob / 精确路径)里**可靠选取**可发布产物:
// Tauri installer + updater bundle + universal artifact;Android APK。
// 写进 GITHUB_OUTPUT 的 `artifacts`(多行)供 action 逐个传 `--artifact`。
//
// 为什么用 node 而非 bash(见 harden-publish-flow design D7):
//   - 不依赖 shell `test -f` —— windows runner 上 `D:/` 盘符 + bash 的路径判断不可靠;
//     node 的 fs 跨平台正确处理盘符与分隔符。
//   - 白名单只保留 SwarmHive 能分类的发布产物,排除 `.sig` 等伴随文件。server/CLI 通过
//     `artifact.kind` 区分 installer/updater/universal,同 target 下多文件不再互相覆盖。
//
// glob 自己实现(支持 `**` / `*` / `?`)—— 不引依赖,且 node 20 没有稳定的 fs.globSync。

import { readdirSync, existsSync, appendFileSync } from "node:fs";
import { join, sep } from "node:path";

// platform 决定白名单:tauri 是 installer/updater/universal;android 就是 APK。
const PLATFORM = (process.env.PLATFORM || "tauri").toLowerCase();

// Tauri 发布产物白名单后缀:
// - installer:公开下载/首次安装。
// - updater:应用内更新。
// - universal:可同时服务公开下载与更新。
const TAURI_INCLUDE = [
  ".app.tar.gz",
  ".dmg",
  ".appimage.tar.gz",
  ".appimage",
  ".deb",
  ".rpm",
  ".nsis.zip",
  ".msi.zip",
  ".msi",
  "-setup.exe",
  ".exe",
];
const INCLUDE = PLATFORM === "android" ? [".apk"] : TAURI_INCLUDE;

const splitLines = (s) =>
  (s || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

/** 路径是否是可发布 artifact(过 .sig、命中白名单)。大小写不敏感。 */
function isArtifact(p) {
  const low = p.toLowerCase();
  if (low.endsWith(".sig")) return false; // .sig 由 CLI 自动配对,不作为 artifact
  return INCLUDE.some((e) => low.endsWith(e));
}

/** glob → RegExp(`**` 跨目录、`*` 单段、`?` 单字符;路径统一成 `/`)。 */
function globToRegExp(glob) {
  const g = glob.replace(/\\/g, "/");
  let re = "^";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        re += ".*";
        i++;
        if (g[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp(re + "$");
}

/** 递归列出 dir 下所有文件(路径统一成 `/`)。 */
function walk(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 目录不存在 / 不可读 → 跳过(node,不报 bash 那种 test -f 噪声)
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else acc.push(full.split(sep).join("/"));
  }
}

/** 展开一个 pattern:含通配符 → 走目录匹配;精确路径 → 存在才收(node fs,非 bash)。 */
function expand(pattern) {
  const p = pattern.replace(/\\/g, "/");
  if (!/[*?]/.test(p)) {
    return existsSync(pattern) ? [p] : [];
  }
  // base = 第一个含通配符的段之前的目录前缀,缩小 walk 范围。
  const segs = p.split("/");
  const baseSegs = [];
  for (const s of segs) {
    if (/[*?]/.test(s)) break;
    baseSegs.push(s);
  }
  const base = baseSegs.join("/") || ".";
  const re = globToRegExp(p);
  const all = [];
  walk(base, all);
  return all.filter((f) => re.test(f));
}

const explicit = splitLines(process.env.ARTIFACTS);
const globs = splitLines(process.env.ARTIFACT_PATHS);

let selected;
if (explicit.length) {
  // `artifacts`(显式精确清单)是 escape hatch:原样透传,不过滤(用户已自己挑好)。
  selected = explicit;
} else {
  const set = new Set();
  for (const g of globs) for (const f of expand(g)) set.add(f);
  selected = [...set].filter(isArtifact);
}

selected.sort();
if (selected.length) {
  console.log("selected release artifact(s):");
  for (const f of selected) console.log(`  ✓ ${f}`);
} else {
  console.log("no release artifacts selected from artifact-paths / artifacts");
}

const out = process.env.GITHUB_OUTPUT;
if (out) {
  appendFileSync(
    out,
    [
      `artifacts<<__SWARMHIVE_EOF__\n${selected.join("\n")}\n__SWARMHIVE_EOF__\n`,
      // Deprecated compatibility alias. It now mirrors the full artifact set.
      `updater<<__SWARMHIVE_EOF__\n${selected.join("\n")}\n__SWARMHIVE_EOF__\n`,
    ].join(""),
  );
}
