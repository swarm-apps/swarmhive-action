# SwarmHive Publish Action

把 **Tauri 桌面** 或 **React Native Android** 的发布产物推送到自托管的
[SwarmHive](https://github.com/swarm-apps/swarmhive) server —— 本质是官方 CLI
[`@swarm-hive/cli`](https://www.npmjs.com/package/@swarm-hive/cli) 的一层 GitHub Actions 壳。

> 这个仓库只放 action 本身;SwarmHive 的 server / CLI / SDK 全部在
> [`swarm-apps/swarmhive`](https://github.com/swarm-apps/swarmhive)。

## 用法

### Tauri

```yaml
- uses: swarm-apps/swarmhive-action@v1
  with:
    server: ${{ secrets.SWARMHIVE_SERVER }}   # https://updates.example.com
    token: ${{ secrets.SWARMHIVE_TOKEN }}     # scoped API token
    platform: tauri
    app: swarmdrop
    channel: beta
    artifacts: src-tauri/target/release/bundle
    notes-file: CHANGELOG.md
```

`version` 省略时,Tauri 会自动从 `tauri.conf.json` 读取。

### React Native Android

```yaml
- uses: swarm-apps/swarmhive-action@v1
  with:
    server: ${{ secrets.SWARMHIVE_SERVER }}
    token: ${{ secrets.SWARMHIVE_TOKEN }}
    platform: android
    app: swarmnote
    version: ${{ steps.meta.outputs.version_name }}
    version-code: ${{ steps.meta.outputs.version_code }}
    abi: arm64-v8a
    artifacts: android/app/build/outputs/apk/release/app-release.apk
```

Android 必须显式给 `version` 与 `version-code`。

### 只校验不上传(dry-run)

```yaml
- uses: swarm-apps/swarmhive-action@v1
  with:
    server: ${{ secrets.SWARMHIVE_SERVER }}
    token: ${{ secrets.SWARMHIVE_TOKEN }}
    platform: tauri
    dry-run: "true"
```

## Inputs

| 名称 | 必填 | 说明 |
| --- | --- | --- |
| `server` | ✅ | SwarmHive server URL(如 `https://updates.example.com`)。 |
| `token` | ✅ | scoped API token(存为 secret)。 |
| `platform` | ✅ | `tauri` 或 `android`。 |
| `app` | | App slug(覆盖 `swarmhive.toml`)。 |
| `version` | | 版本号。Tauri 省略时自动读 `tauri.conf.json`;Android 必填。 |
| `version-code` | | Android `versionCode`(Android 必填)。 |
| `channel` | | 发布后 promote 到的渠道(如 `stable`)。 |
| `artifacts` | | 换行分隔的产物路径(覆盖 `swarmhive.toml`)。 |
| `abi` | | Android 目标 ABI(如 `arm64-v8a`)。 |
| `notes-file` | | 注入 release 的 changelog / 发布说明文件(仅 publish)。 |
| `no-publish` | | `true` 则只上传 + 写产物,release 留 draft。默认 `false`。 |
| `dry-run` | | `true` 则只校验、不上传。默认 `false`。 |
| `cli-version` | | 运行的 `@swarm-hive/cli` 版本。默认 `latest`。 |

鉴权走 env:action 内部把 `server` / `token` 注入 `SWARMHIVE_SERVER` / `SWARMHIVE_TOKEN`
后调用 `npx @swarm-hive/cli <verb> <platform>`。完整 CLI 语义见
[SwarmHive CLI 文档](https://github.com/swarm-apps/swarmhive)。

## 版本

`@v1` 是会随 `v1.x.y` 滚动的大版本 tag;要钉死就用 `@v1.0.0` 这种全版本 tag。

## License

[Apache-2.0](./LICENSE)
