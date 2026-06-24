# SwarmHive Publish Action

把 **Tauri 桌面** 或 **React Native Android** 的发布产物推送到自托管的
[SwarmHive](https://github.com/swarm-apps/swarmhive) server —— 官方 CLI
[`@swarm-hive/cli`](https://www.npmjs.com/package/@swarm-hive/cli) 的一层 GitHub Actions 壳。

> 这个仓库只放 action 本身;SwarmHive 的 server / CLI / SDK 全部在
> [`swarm-apps/swarmhive`](https://github.com/swarm-apps/swarmhive)。

**v2 做了什么(对比 v1):**

- **内置 release artifact 选取** —— 你只给 `artifact-paths`(glob 即可),action 用 node 跨平台
  可靠挑出 Tauri 安装包、updater bundle、universal artifact,或 Android APK。SwarmHive 通过
  `artifact.kind` 区分 `installer` / `updater` / `universal`,同一 target 下安装包和升级包可以共存,
  同一个 release 同时服务官网公开下载和应用内更新。
- **上传与发布解耦** —— `publish` 默认只上传到 **draft**;`finalize: true` 才发布。多 target
  推荐「N 个 per-target 上传 → 末步一次 finalize」,杜绝并发抢发布丢 artifact。
- **退出码红绿** —— CLI 永久错误(权限/配置)`exit 2` + `::error::`,可重试(5xx/网络)`exit 1`
  + `::warning::`;step 按退出码红绿,**不再 `continue-on-error` 吞掉权限错误**。403 的可执行
  补救提示直接透传到 annotation。
- **`cli-version` 钉稳定版** —— 默认具体版本(不再用会无声滑动的 `latest`),并打印 resolved 版本。

## 快速开始

### Tauri(多 target → 一次 finalize)

```yaml
jobs:
  # 统一版本(去掉 tag 前导 v),publish 与 finalize 共用,避免版本错配。
  version:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.v.outputs.version }}
    steps:
      - id: v
        run: echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"

  publish-tauri:
    needs: version
    strategy:
      fail-fast: false
      matrix:
        include:
          - { os: macos-latest,   target: aarch64-apple-darwin }
          - { os: macos-latest,   target: x86_64-apple-darwin }
          - { os: ubuntu-latest,  target: x86_64-unknown-linux-gnu }
          - { os: windows-latest, target: x86_64-pc-windows-msvc }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      # ... 你的 Tauri 构建步骤(tauri-apps/tauri-action 等),产出安装包 + updater bundle ...
      - uses: swarm-apps/swarmhive-action@v2
        with:
          server: ${{ secrets.SWARMHIVE_SERVER }}
          token: ${{ secrets.SWARMHIVE_TOKEN }}
          platform: tauri
          app: swarmdrop
          version: ${{ needs.version.outputs.version }}
          target: ${{ matrix.target }}
          # 给 glob 即可;action 自动保留 installer / updater / universal:
          artifact-paths: |
            src-tauri/target/${{ matrix.target }}/release/bundle/**/*

  finalize:
    needs: [version, publish-tauri]
    runs-on: ubuntu-latest
    steps:
      - uses: swarm-apps/swarmhive-action@v2
        with:
          server: ${{ secrets.SWARMHIVE_SERVER }}
          token: ${{ secrets.SWARMHIVE_TOKEN }}
          app: swarmdrop
          version: ${{ needs.version.outputs.version }}
          finalize: "true"
          channel: stable
```

> 单 target / 想一步发布?给一个上传 step 加 `finalize: "true"`(可选 `channel: stable`)即可,
> 不必拆 finalize job。

### React Native Android

```yaml
- uses: swarm-apps/swarmhive-action@v2
  with:
    server: ${{ secrets.SWARMHIVE_SERVER }}
    token: ${{ secrets.SWARMHIVE_TOKEN }}
    platform: android
    app: swarmdrop-rn
    version: ${{ steps.meta.outputs.version_name }}
    version-code: ${{ steps.meta.outputs.version_code }}
    abi: arm64-v8a
    artifact-paths: android/app/build/outputs/apk/release/*.apk
    finalize: "true"
    channel: stable
```

Android 必须显式给 `version` 与 `version-code`。单一 APK,一步上传 + finalize 即可。

### 只校验不上传(dry-run)

```yaml
- uses: swarm-apps/swarmhive-action@v2
  with:
    token: ${{ secrets.SWARMHIVE_TOKEN }}
    platform: tauri
    artifact-paths: src-tauri/target/**/release/bundle/**/*
    dry-run: "true"
```

## Inputs

| 名称 | 必填 | 说明 |
| --- | --- | --- |
| `token` | ✅ | scoped API token(存为 secret)。用 `swarmhive tokens create --kind api --preset ci-publish` 生成。 |
| `server` | | SwarmHive server URL;若已写进 `swarmhive.toml` 可省。 |
| `platform` | | `tauri`(默认)或 `android`。finalize-only step 不需要。 |
| `app` | | App slug(覆盖 `swarmhive.toml`)。 |
| `version` | | 版本号。Tauri 省略时自动读 `tauri.conf.json`;Android / finalize 必填。 |
| `version-code` | | Android `versionCode`(Android 必填)。 |
| `abi` | | Android 目标 ABI(如 `arm64-v8a`)。 |
| `target` | | Tauri target triple;**多 target 必填**(每个 target 各调一次 action)。 |
| `artifact-paths` | | 换行分隔的 glob / 路径;action 自动挑 SwarmHive release artifacts。**首选**。 |
| `artifacts` | | escape hatch:换行分隔的**精确**路径,原样透传不过滤。 |
| `channel` | | 发布后 promote 到的渠道(如 `stable`)。隐含 finalize。 |
| `finalize` | | `true` 则发布(上传 step 内一步发布;无产物则 finalize-only step)。默认 `false`。 |
| `notes-file` | | 注入 release 的 changelog 文件(仅上传 step)。 |
| `dry-run` | | `true` 则只校验、不上传。默认 `false`。 |
| `cli-version` | | 运行的 `@swarm-hive/cli` 版本。默认钉稳定版(不用 `latest`)。需 ≥ 0.6.0。 |

## Outputs

| 名称 | 说明 |
| --- | --- |
| `artifacts` | 从 `artifact-paths` 选中的 release artifacts(换行分隔)。 |
| `updater` | 兼容旧 workflow 的别名,内容等同 `artifacts`。 |
| `resolved-cli-version` | 实际运行的 `@swarm-hive/cli` 版本。 |
| `exit-code` | 成功时为 `0`;失败时 step 直接标红(看 `::error::` / `::warning::` annotation)。 |

## CI token 权限

用 `ci-publish` 预设一条命令铸好,**已含本次事故缺失的 `release:update`**(重发改 notes 需要):

```bash
swarmhive tokens create --kind api --preset ci-publish --name <app>-ci
gh secret set SWARMHIVE_TOKEN --body <paste-token>
# server 若未写进 swarmhive.toml:
gh secret set SWARMHIVE_SERVER --body https://updates.example.com
```

`ci-publish` 展开为:`app:read`、`release:read`、`release:create`、`release:update`、
`release:publish`、`release:promote`、`artifact:upload`。

- **首发**一个新 version:需要 `release:create` + `artifact:upload`(+ `release:publish` 才能 finalize)。
- **重发 / 改 notes**:额外需要 `release:update` —— 缺它时 403,action 会把补救提示透传到
  `::error::`(`swarmhive tokens create --kind api --preset ci-publish`)。

## Action ↔ CLI 版本矩阵

| action | `@swarm-hive/cli` | 发布语义 |
| --- | --- | --- |
| `@v1` | `0.4.x` | `publish` 默认发布;手写 bundle 选取;`continue-on-error` 吞错。 |
| `@v2` | `>= 0.6.0` | `publish` 默认 draft + `finalize`;内置 artifact 选取;退出码红绿。 |

`@v2` 需要支持 `artifact.kind` 的 `@swarm-hive/cli` 与 server;否则同 target 下同时上传安装包和
updater bundle 会退化成旧唯一键语义。`@v1` 与新 CLI 不兼容(CLI 已移除 `--no-publish`、默认改
draft)——升级 action 与 CLI 要成对做。

## 从 v1 迁移到 v2(破坏性变更)

1. `uses: swarm-apps/swarmhive-action@v1` → `@v2`。
2. 删掉 workflow 里手写的「挑 updater bundle」bash;改用 `artifact-paths`(给 glob),让 action
   同时保留安装包和升级包。
3. 删掉 publish step 上的 `continue-on-error: true`(现在退出码红绿可信;权限错不再被吞)。
4. 多 target:每个 target 上传到 draft(不加 finalize)→ 末步加一个 `finalize: "true"` 的 job
   (或单 target 直接在上传 step 加 `finalize: "true"`)。
5. 移除 `no-publish` input(已删;默认即 draft)。
6. `cli-version` 若钉了 `0.4.x` / `0.5.x` → 升到 `0.6.0`(或留空用默认)。

## 版本

`@v2` 是会随 `v2.x.y` 滚动的大版本 tag;要钉死就用 `@v2.1.0` 这种全版本 tag。推 `v2.1.0` tag
时 `.github/workflows/release.yml` 会自动把 `v2` major tag 指过去。

## License

[Apache-2.0](./LICENSE)
