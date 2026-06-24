// 从 `artifact-paths`(换行分隔的 glob / 精确路径)里**可靠选取**真正的 Tauri updater
// bundle,写进 GITHUB_OUTPUT 的 `updater`(多行)供 action 逐个传 `--artifact`。
//
// 为什么用 node 而非 bash(见 harden-publish-flow design D7):
//   - 不依赖 shell `test -f` —— windows runner 上 `D:/` 盘符 + bash 的路径判断不可靠;
//     node 的 fs 跨平台正确处理盘符与分隔符。
//   - 白名单只保留真 updater bundle,**显式排除安装包**,避免 `.deb`/`.dmg` 等被误当产物
//     (artifact 唯一键是 (release,platform,target,arch,abi),同 target 多文件会互相覆盖)。
//
// glob 自己实现(支持 `**` / `*` / `?`)—— 不引依赖,且 node 20 没有稳定的 fs.globSync。

import { readdirSync, existsSync, appendFileSync } from "node:fs";
import { join, sep } from "node:path";

// platform 决定白名单:tauri 是各 OS 的 updater bundle;android 就是 APK。
const PLATFORM = (process.env.PLATFORM || "tauri").toLowerCase();

// Tauri updater bundle 白名单后缀(真正能被客户端 updater 拉取/安装的产物)。
const TAURI_INCLUDE = [
  ".app.tar.gz",
  ".appimage.tar.gz",
  ".appimage",
  ".nsis.zip",
  "-setup.exe",
];
const INCLUDE = PLATFORM === "android" ? [".apk"] : TAURI_INCLUDE;
// 安装包后缀:显式排除 —— 不是 updater bundle,留在 GitHub Release 即可(仅 tauri 相关)。
const EXCLUDE = [".deb", ".dmg", ".msi", ".rpm"];

const splitLines = (s) =>
  (s || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

/** 路径是否是 updater bundle(过 .sig、过安装包、命中白名单)。大小写不敏感。 */
function isBundle(p) {
  const low = p.toLowerCase();
  if (low.endsWith(".sig")) return false; // .sig 由 CLI 自动配对,不作为 artifact
  if (EXCLUDE.some((e) => low.endsWith(e))) return false;
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
  selected = [...set].filter(isBundle);
  // 同 target 唯一键 (release,platform,target,arch,abi) —— 一个 target 只应留一个 updater
  // bundle,否则后传的覆盖先传的。action 按 target 调用,单次只含一个 OS 的产物,故下面的
  // 全局「优先级」判定安全:
  //   - windows:`-setup.exe` 优先于 `.nsis.zip`(二者都是 NSIS 的 updater 形态)。
  //   - linux:`.AppImage.tar.gz`(updater bundle)优先于裸 `.AppImage`(可执行体)。
  const lower = (f) => f.toLowerCase();
  if (selected.some((f) => lower(f).endsWith("-setup.exe"))) {
    selected = selected.filter((f) => !lower(f).endsWith(".nsis.zip"));
  }
  if (selected.some((f) => lower(f).endsWith(".appimage.tar.gz"))) {
    selected = selected.filter((f) => !lower(f).endsWith(".appimage"));
  }
}

selected.sort();
if (selected.length) {
  console.log("selected updater bundle(s):");
  for (const f of selected) console.log(`  ✓ ${f}`);
} else {
  console.log("no updater bundles selected from artifact-paths / artifacts");
}

const out = process.env.GITHUB_OUTPUT;
if (out) {
  appendFileSync(
    out,
    `updater<<__SWARMHIVE_EOF__\n${selected.join("\n")}\n__SWARMHIVE_EOF__\n`,
  );
}
