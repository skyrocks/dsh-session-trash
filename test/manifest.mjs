// 发布前自检：包里声明的入口真的存在，cordis.patch.yml 的行名与包名一致，
// files 白名单没漏掉运行时模块。CI 与本机 `node test/manifest.mjs` 都会跑。
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TYPERT } from "../typert.host.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (name) => readFileSync(join(root, name), "utf8");
const manifest = JSON.parse(read("package.json"));

assert.equal(typeof manifest.name, "string");
assert.match(manifest.name, /^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/);
assert.equal(typeof manifest.version, "string");
assert.equal(manifest.type, "module");
assert.equal(manifest.main, "./index.js");
assert.equal(manifest.exports["."], "./index.js");
assert.equal(manifest.dsh?.manifestVersion, 1);
assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
assert.equal(manifest.dsh?.client?.platform, "web");

// 包名必须等于插件行名：DSH 按模块名解析 bundle 里的插件行。
const patch = read("cordis.patch.yml");
const rowName = patch.match(/name:\s*"?([^"\s]+)"?/)?.[1];
assert.equal(rowName, manifest.name, "cordis.patch.yml 的插件行名必须与包名一致");

// 两个非默认入口必须与 files 白名单一致，否则装完客户端/typert 半边会缺。
for (const [key, file] of [
  ["./client", "./client.js"],
  ["./typert", "./typert.host.js"],
  ["./package.json", "./package.json"]
]) {
  assert.equal(manifest.exports[key], file, `exports["${key}"] 不对`);
}

// 运行时模块都要在 files 白名单里。
for (const file of [
  "index.js",
  "trash.js",
  "session-ops.js",
  "client.js",
  "typert.host.js",
  "cordis.patch.yml",
  "README.md",
  "README.en.md",
  "CHANGELOG.md",
  "LICENSE"
]) {
  assert.ok(manifest.files.includes(file), `files 缺少 ${file}`);
  assert.ok(existsSync(join(root, file)), `仓库里缺少 ${file}`);
}
// 测试留在仓库里，但不随包分发：自动化商店会把包内测试里的 node:fs 当成运行时权限信号。
for (const file of ["test/smoke.mjs", "test/manifest.mjs"]) {
  assert.ok(existsSync(join(root, file)), `仓库里缺少 ${file}`);
}
assert.ok(!manifest.files.includes("test"), "files 不应包含 test");

// 图标与本地化元数据随包分发；files 用通配符，按条目单独断言。
for (const file of ["icon.svg", "locale/zh.json", "locale/en.json"]) {
  assert.ok(existsSync(join(root, file)), `仓库里缺少 ${file}`);
}
for (const entry of ["icon.svg", "locale/*.json"]) {
  assert.ok(manifest.files.includes(entry), `files 缺少 ${entry}`);
}
assert.equal(manifest.exports?.["./icon"], "./icon.svg");
assert.equal(manifest.exports?.["./locale/*.json"], "./locale/*.json");

// PUBLISHING.md 是维护者文档，不该进 tarball。
assert.ok(!manifest.files.includes("PUBLISHING.md"), "files 不应包含 PUBLISHING.md");

// 零运行时依赖：只允许宿主提供的 peerDependencies。
assert.equal(manifest.dependencies, undefined);
for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
  assert.ok(peer === "react" || peer.startsWith("@deepseek-ai/"), `意外的 peerDependency：${peer}`);
}

// typert 清单：包名一致、五个调用、id 归属正确。
assert.equal(TYPERT.package, manifest.name);
assert.equal(TYPERT.face, "host");
assert.equal(TYPERT.invocations.length, 5);
const methods = TYPERT.invocations.map((invocation) => invocation.method).sort();
assert.deepEqual(methods, ["delete", "list", "purge", "purgeAll", "restore"]);
for (const invocation of TYPERT.invocations) {
  assert.ok(invocation.id.startsWith(`${manifest.name}#sessionTrash/`), `invocation id 不属于本包：${invocation.id}`);
  assert.equal(invocation.service, "sessionTrash");
  assert.equal(invocation.invocation.kind, "direct");
}

// Host 服务键与 client 的 remote 命名空间必须一致，否则 $mount 后拿不到 ctx.remote.sessionTrash。
const index = read("index.js");
const client = read("client.js");
assert.match(index, /super\(ctx, "sessionTrash"\)/);
assert.match(client, /service: "sessionTrash"/);
assert.match(client, /ctx\.remote\.\$mount\(REMOTE\)/);

console.log(`manifest ok — ${manifest.name}@${manifest.version}（插件行 ${rowName}，${TYPERT.invocations.length} 个调用）`);
