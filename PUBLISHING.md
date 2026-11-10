# 发布清单（维护者用）

这份文件不会随 tarball 发布，只用于把仓库整理成可公开的状态。

## 1. 检查

```sh
node test/smoke.mjs            # 19 项单元/接线测试
node test/manifest.mjs         # 入口、files 白名单、插件行名、typert 清单
node --check client.js         # 客户端 bundle 语法
grep -n "YOUR_GITHUB_NAME" README.md README.en.md package.json   # 应无输出
```

预览图是 `docs/preview-*.png`，源文件为同目录 SVG；改图后重新渲染：

```sh
rsvg-convert -w 1800 docs/preview-menu.svg  -o docs/preview-menu.png
rsvg-convert -w 1650 docs/preview-trash.svg -o docs/preview-trash.png
```

## 2. 上传

仓库根目录是 **本目录的内容**（`package.json` 与 `cordis.patch.yml` 在根），
不要把外层父目录一起上传，否则 `github:skyrocks/dsh-session-trash` 安装会找不到插件清单。

```sh
git init -b main
git add -A
git commit -m "feat: session trash plugin for DeepSeek Harness"
gh repo create skyrocks/dsh-session-trash --public --source=. --remote=origin --push
git tag v0.1.0
git push origin v0.1.0
```

## 3. Release

```sh
pnpm pack                      # 生成 skyrocks-dsh-session-trash-0.1.0.tgz
npm publish --access public    # 发布到 npm（名字带 scope）
gh release create v0.1.0 ./skyrocks-dsh-session-trash-0.1.0.tgz \
  --title "v0.1.0" --generate-notes
```

## 4. 发布前检查

- [x] `node test/smoke.mjs` 通过（19 项）
- [x] `node test/manifest.mjs` 通过
- [x] 所有模块 `node --check` 通过
- [x] README 预览图为 PNG（`docs/preview-*.png`），源文件为同目录 SVG
- [x] `package.json` 含 `repository` / `homepage` / `bugs`
- [ ] CI 在 Ubuntu / macOS / Windows 上全绿（推送后自动跑）
- [ ] **真机实测**：安装后完全退出重启，见下节自检步骤
- [ ] Release 附件与 `package.json` 版本一致

## 5. 真机自检（发布前必须做一次）

```sh
dsh plugin --profile desktop add "link:$PWD"
# 完全退出 DSH，再打开
```

1. 右键任意会话 → 菜单底部出现「删除会话…」；
2. 设置里出现「回收站」页；
3. 删一个**已归档**的会话：侧栏消失、toast 出现「撤销」、`~/.dsh/trash/sessions/` 出现条目；
4. 点「撤销」：目录搬回、侧栏恢复；
5. 再删一次，去「设置 → 回收站」：能看到条目并「恢复」；
6. 打开一个会话再尝试删除它：应提示「正在本机打开」；
7. 在有子会话的会话上删除：条目应显示「含 N 个子会话」，恢复后子会话一起回来。

## 6. 设计口径（避免再次误解）

- **删除 = 移到回收站**，不是 `rm -rf`；清空回收站才真正释放磁盘。
- **子会话随父会话一起走**：`origin === 'subagent'` 的后代进同一条目；fork 不动。
- **只归档不删除**是 DSH 上游的现状（持久化 seam 没有删除 API），本插件不碰上游文件，
  只在自己能负责的边界内搬目录、清归档/置顶标记。
- **`workspace.json` 的悬空 id 是已知取舍**：注册表没有移除成员槽位的公开 API，前端会过滤显示。
- **附件不随会话删除**：内容寻址共享，需要单独 GC，不在本插件范围。
