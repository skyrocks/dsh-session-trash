// 纯逻辑回归：不依赖 DSH 运行时，直接 `node test/smoke.mjs`。
// 覆盖：回收站文件系统、删除/恢复编排、client 扩展点接线、包名一致性。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTrashStore, directorySize, isEntryId, movePath } from "../trash.js";
import { lineageOf, removeSession, restoreSession } from "../session-ops.js";

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

// ---------------------------------------------------------------- 工具

async function sandbox() {
  const base = await mkdtemp(join(tmpdir(), "dsh-trash-test-"));
  const store = createTrashStore({ root: join(base, "trash") });
  const sessions = join(base, "sessions", "--proj--");
  return { base, root: join(base, "trash"), store, sessions };
}

/** 造一个会话目录：<sessions>/<id>/session.v4.jsonl.zstd */
async function makeSession(sessions, id, payload = "0123456789") {
  const directory = join(sessions, id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "session.v4.jsonl.zstd"), payload);
  await writeFile(join(directory, "session.lock"), "");
  return directory;
}

function addOne(store, { sessionId, title, originalPath, wasArchived, wasPinned }) {
  return store.add({
    rootSessionId: sessionId,
    title,
    sessions: [{ sessionId, originalPath, wasArchived, wasPinned }]
  });
}

function snapshotFor(id, { cwd = "/tmp/proj", origin, parentSession, path } = {}) {
  return {
    header: { id, cwd, origin, parentSession },
    location: path === undefined ? undefined : { kind: "jsonl", path }
  };
}

function fakeRegistry({ archived = [], pinned = [], active = new Set(), activity = null } = {}) {
  const archivedSet = new Set(archived);
  const pinnedSet = new Set(pinned);
  const calls = [];
  return {
    calls,
    get archivedSessionIds() {
      return [...archivedSet];
    },
    get pinnedSessionIds() {
      return [...pinnedSet];
    },
    async archiveSession(id) {
      if (activity !== null || active.has(id)) {
        const error = new Error("active");
        error.name = "WorkspaceActiveSessionError";
        error.activity = activity ?? [{ kind: "turn", items: [{ id, label: "正在生成" }] }];
        throw error;
      }
      calls.push(["archive", id]);
      archivedSet.add(id);
    },
    async unarchiveSession(id) {
      calls.push(["unarchive", id]);
      archivedSet.delete(id);
    },
    async pinSession(id) {
      calls.push(["pin", id]);
      pinnedSet.add(id);
    },
    async unpinSession(id) {
      calls.push(["unpin", id]);
      pinnedSet.delete(id);
    },
    snapshot() {
      return { archived: [...archivedSet], pinned: [...pinnedSet] };
    }
  };
}

const fakeSessions = (live = []) => ({ get: (id) => (live.includes(id) ? { id } : undefined) });

// ---------------------------------------------------------------- 回收站

await test("add 会把会话目录整体搬走并写 meta", async () => {
  const { store, sessions } = await sandbox();
  const original = await makeSession(sessions, "session-aaa");

  const meta = await addOne(store, { sessionId: "session-aaa", title: "测试会话", originalPath: original, wasArchived: true });

  assert.match(meta.trashId, /^\d{10,16}-session-aaa$/);
  assert.equal(meta.sessions.length, 1);
  assert.equal(meta.sessions[0].hasData, true);
  assert.equal(meta.sessions[0].bytes, 10);
  assert.equal(meta.sessions[0].wasArchived, true);
  assert.equal(meta.bytes, 10);

  await assert.rejects(stat(original), { code: "ENOENT" });
  const stored = await readFile(join(store.root, meta.trashId, "sessions", "session-aaa", "session.v4.jsonl.zstd"), "utf8");
  assert.equal(stored, "0123456789");

  const { entries } = await store.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].rootSessionId, "session-aaa");
  assert.equal(entries[0].title, "测试会话");
});

await test("一次删除可以把父会话和子会话一起搬走并一起恢复", async () => {
  const { store, sessions } = await sandbox();
  const parent = await makeSession(sessions, "session-parent", "parent");
  const childA = await makeSession(sessions, "session-child-a", "a");
  const childB = await makeSession(sessions, "session-child-b", "bb");

  const meta = await store.add({
    rootSessionId: "session-parent",
    title: "父会话",
    sessions: [
      { sessionId: "session-parent", originalPath: parent },
      { sessionId: "session-child-a", originalPath: childA },
      { sessionId: "session-child-b", originalPath: childB }
    ]
  });

  assert.equal(meta.sessions.length, 3);
  assert.equal(meta.bytes, 6 + 1 + 2);
  for (const path of [parent, childA, childB]) await assert.rejects(stat(path), { code: "ENOENT" });

  await store.restore(meta.trashId);
  assert.equal(await readFile(join(parent, "session.v4.jsonl.zstd"), "utf8"), "parent");
  assert.equal(await readFile(join(childA, "session.v4.jsonl.zstd"), "utf8"), "a");
  assert.equal(await readFile(join(childB, "session.v4.jsonl.zstd"), "utf8"), "bb");
  assert.deepEqual(await readdir(store.root), []);
});

await test("原位置被占用时 restore 整体中止，且不破坏条目", async () => {
  const { store, sessions } = await sandbox();
  const free = await makeSession(sessions, "session-free");
  const taken = await makeSession(sessions, "session-taken");
  const meta = await store.add({
    rootSessionId: "session-free",
    sessions: [
      { sessionId: "session-free", originalPath: free },
      { sessionId: "session-taken", originalPath: taken }
    ]
  });
  await mkdir(taken, { recursive: true });

  await assert.rejects(store.restore(meta.trashId), (error) => error.code === "trash/restore-conflict");
  await assert.rejects(stat(free), { code: "ENOENT" });
  const { entries } = await store.list();
  assert.equal(entries.length, 1);
});

await test("没有数据的条目也能恢复（只清条目）", async () => {
  const { store } = await sandbox();
  const meta = await addOne(store, { sessionId: "session-ghost", originalPath: null });
  assert.equal(meta.sessions[0].hasData, false);
  const restored = await store.restore(meta.trashId);
  assert.equal(restored.rootSessionId, "session-ghost");
  assert.deepEqual(await readdir(store.root), []);
});

await test("源目录缺失时整体回滚，不在回收站留半条记录", async () => {
  const { store, sessions } = await sandbox();
  const present = await makeSession(sessions, "session-present");
  await assert.rejects(
    store.add({
      rootSessionId: "session-present",
      sessions: [
        { sessionId: "session-present", originalPath: present },
        { sessionId: "session-missing", originalPath: join(sessions, "session-missing") }
      ]
    }),
    (error) => error.code === "trash/missing-source"
  );
  assert.equal(await readFile(join(present, "session.v4.jsonl.zstd"), "utf8"), "0123456789");
  assert.deepEqual(await readdir(store.root), []);
});

await test("非法条目 id 不能越界", async () => {
  const { store } = await sandbox();
  for (const bad of ["../escape", "/etc", "abc", "", "123-session-x/../../y"]) assert.equal(isEntryId(bad), false, bad);
  await assert.rejects(store.restore("../../etc/passwd"), (error) => error.code === "trash/invalid-id");
});

await test("purge 删除条目，purgeAll 清空", async () => {
  const { store, sessions } = await sandbox();
  const a = await addOne(store, { sessionId: "session-d", originalPath: await makeSession(sessions, "session-d") });
  await store.purge(a.trashId);
  assert.deepEqual(await readdir(store.root), []);

  await addOne(store, { sessionId: "session-e", originalPath: await makeSession(sessions, "session-e") });
  await addOne(store, { sessionId: "session-f", originalPath: await makeSession(sessions, "session-f") });
  assert.equal(await store.purgeAll(), 2);
  assert.deepEqual(await readdir(store.root), []);
});

await test("purgeExpired 只清理超过保留期的条目", async () => {
  const { store, sessions } = await sandbox();
  const old = await addOne(store, { sessionId: "session-old", originalPath: await makeSession(sessions, "session-old") });
  await addOne(store, { sessionId: "session-new", originalPath: await makeSession(sessions, "session-new") });

  const metaPath = join(store.root, old.trashId, "meta.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8"));
  meta.deletedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
  await writeFile(metaPath, JSON.stringify(meta));

  assert.equal(await store.purgeExpired(7), 1);
  assert.equal(await store.purgeExpired(0), 0);
  const { entries } = await store.list();
  assert.deepEqual(entries.map((entry) => entry.rootSessionId), ["session-new"]);
});

await test("directorySize 与 movePath 基本行为", async () => {
  const { base, sessions } = await sandbox();
  const original = await makeSession(sessions, "session-size", "123456");
  assert.equal(await directorySize(original), 6);
  const target = join(base, "moved");
  await movePath(original, target);
  assert.equal(await directorySize(target), 6);
  await assert.rejects(stat(original), { code: "ENOENT" });
  assert.equal(await directorySize(join(base, "missing")), 0);
});

// ---------------------------------------------------------------- 编排

await test("lineageOf 只沿 subagent 血缘走，fork 不算在内", () => {
  const snapshots = [
    snapshotFor("root"),
    snapshotFor("child-a", { origin: "subagent", parentSession: "root" }),
    snapshotFor("child-b", { origin: "subagent", parentSession: "root" }),
    snapshotFor("grand", { origin: "subagent", parentSession: "child-a" }),
    snapshotFor("fork", { origin: "fork", parentSession: "root" })
  ];
  assert.deepEqual(lineageOf(snapshots, "root"), ["root", "child-a", "child-b", "grand"]);
});

await test("未归档的会话会先归档，删完再把标记清掉", async () => {
  const { store, sessions } = await sandbox();
  const path = await makeSession(sessions, "session-a", "log");
  const registry = fakeRegistry();

  const result = await removeSession({
    sessionId: "session-a",
    title: "会话 A",
    persistence: { list: async () => [snapshotFor("session-a", { path: join(path, "session.v4.jsonl.zstd") })] },
    registry,
    sessions: fakeSessions(),
    store
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.sessionIds, ["session-a"]);
  assert.equal(result.hasData, true);
  assert.equal(result.bytes, 3);
  assert.deepEqual(registry.snapshot(), { archived: [], pinned: [] });
  assert.deepEqual(registry.calls, [["archive", "session-a"], ["unarchive", "session-a"]]);
  await assert.rejects(stat(path), { code: "ENOENT" });

  const { entries } = await store.list();
  assert.equal(entries[0].title, "会话 A");
  assert.equal(entries[0].sessions[0].wasArchived, false);
});

await test("父会话和 subagent 子会话一起删、一起恢复", async () => {
  const { store, sessions } = await sandbox();
  const parent = await makeSession(sessions, "session-parent", "parent");
  const child = await makeSession(sessions, "session-child", "child");
  const registry = fakeRegistry({ archived: ["session-parent", "session-child"] });

  const result = await removeSession({
    sessionId: "session-parent",
    persistence: {
      list: async () => [
        snapshotFor("session-parent", { path: join(parent, "session.v4.jsonl.zstd") }),
        snapshotFor("session-child", { origin: "subagent", parentSession: "session-parent", path: join(child, "session.v4.jsonl.zstd") })
      ]
    },
    registry,
    sessions: fakeSessions(),
    store
  });

  assert.deepEqual(result.sessionIds, ["session-parent", "session-child"]);
  assert.equal(result.bytes, 11);
  await assert.rejects(stat(child), { code: "ENOENT" });

  await restoreSession({ trashId: result.trashId, store, registry });
  assert.equal(await readFile(join(child, "session.v4.jsonl.zstd"), "utf8"), "child");
  assert.deepEqual(registry.snapshot(), { archived: ["session-parent", "session-child"], pinned: [] });
});

await test("会话（或它的子会话）在本机打开时拒绝删除", async () => {
  const { store } = await sandbox();
  const snapshots = [snapshotFor("root"), snapshotFor("child", { origin: "subagent", parentSession: "root" })];
  await assert.rejects(
    removeSession({
      sessionId: "root",
      persistence: { list: async () => snapshots },
      registry: fakeRegistry(),
      sessions: fakeSessions(["child"]),
      store
    }),
    (error) => error.code === "session/live"
  );
  assert.deepEqual(await store.list(), { entries: [], skipped: 0 });
});

await test("归档被活动检查拒绝时，把工作清单翻译成可读错误，且不搬任何文件", async () => {
  const { store, sessions } = await sandbox();
  const parent = await makeSession(sessions, "session-busy", "log");
  const child = await makeSession(sessions, "session-child");
  const registry = fakeRegistry({ archived: ["session-busy"], active: new Set(["session-child"]) });

  await assert.rejects(
    removeSession({
      sessionId: "session-busy",
      persistence: {
        list: async () => [
          snapshotFor("session-busy", { path: join(parent, "session.v4.jsonl.zstd") }),
          snapshotFor("session-child", { origin: "subagent", parentSession: "session-busy", path: join(child, "session.v4.jsonl.zstd") })
        ]
      },
      registry,
      sessions: fakeSessions(),
      store
    }),
    (error) => error.code === "session/active" && error.message.includes("进行中的回合")
  );

  assert.deepEqual(registry.snapshot(), { archived: ["session-busy"], pinned: [] });
  assert.equal(await readFile(join(parent, "session.v4.jsonl.zstd"), "utf8"), "log");
});

await test("找不到会话日志时报 session/unknown", async () => {
  const { store } = await sandbox();
  await assert.rejects(
    removeSession({
      sessionId: "session-gone",
      persistence: { list: async () => [] },
      registry: fakeRegistry(),
      sessions: fakeSessions(),
      store
    }),
    (error) => error.code === "session/unknown"
  );
});

await test("没有落盘位置的会话也能删（只清标记）", async () => {
  const { store } = await sandbox();
  const result = await removeSession({
    sessionId: "session-nofile",
    persistence: { list: async () => [snapshotFor("session-nofile")] },
    registry: fakeRegistry({ archived: ["session-nofile"] }),
    sessions: fakeSessions(),
    store
  });
  assert.equal(result.hasData, false);
});

await test("restore 搬回目录并按原状态补回归档标记", async () => {
  const { store, sessions } = await sandbox();
  const path = await makeSession(sessions, "session-c", "log");
  const registry = fakeRegistry({ archived: ["session-c"] });
  const removed = await removeSession({
    sessionId: "session-c",
    persistence: { list: async () => [snapshotFor("session-c", { path: join(path, "session.v4.jsonl.zstd") })] },
    registry,
    sessions: fakeSessions(),
    store
  });

  const restored = await restoreSession({ trashId: removed.trashId, store, registry });
  assert.deepEqual(restored.sessionIds, ["session-c"]);
  assert.equal(await readFile(join(path, "session.v4.jsonl.zstd"), "utf8"), "log");
  assert.deepEqual(registry.snapshot(), { archived: ["session-c"], pinned: [] });
});

// ---------------------------------------------------------------- client 接线

await test("client bundle 导出 apply/inject，扩展点挂载正确", async () => {
  let factory;
  globalThis.window = {
    __ModuleLoader__: {
      load({ id, factory: contributed }) {
        assert.equal(id, "@skyrocks/dsh-session-trash");
        factory = contributed;
      }
    }
  };
  await import("../client.js");
  assert.equal(typeof factory, "function");

  const React = {
    createElement: (...args) => ({ args }),
    Fragment: Symbol("Fragment"),
    useState: () => [null, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useSyncExternalStore: () => null
  };
  const clientExports = factory((name) => {
    if (name === "react") return React;
    throw new Error(`unexpected require: ${name}`);
  });
  assert.equal(typeof clientExports.apply, "function");
  assert.deepEqual(clientExports.inject, ["slots", "remote"]);

  const calls = [];
  const slots = {
    inject(name, callback) {
      calls.push(["inject", name]);
      callback();
    },
    register(options) {
      calls.push(["register", options.name, options.id, options.order]);
      return () => {};
    }
  };
  const contextMenus = {
    register(definition) {
      calls.push(["menu", definition.id, definition.target]);
      calls.push(["menu-resolve", definition.resolve({ sessionId: "session-x", displayTitle: "标题 X" })]);
      calls.push(["menu-resolve-empty", definition.resolve({})]);
      return () => {};
    },
    notify() {}
  };
  const ctx = {
    get: (name) => ({ slots, remote: undefined, contextMenus, sessions: undefined })[name],
    effect: (fn) => fn(),
    remote: {
      $mount(manifest) {
        calls.push(["mount", manifest.package, manifest.descriptors.length]);
        return Promise.resolve();
      }
    }
  };
  clientExports.apply(ctx);

  assert.deepEqual(calls[0], ["mount", "@skyrocks/dsh-session-trash", 5]);
  assert.deepEqual(
    calls.filter((call) => call[0] === "inject").map((call) => call[1]),
    ["shell.overlay", "settings.section"]
  );
  assert.deepEqual(
    calls.filter((call) => call[0] === "register").map((call) => call[2]),
    ["session-trash-confirm", "session-trash"]
  );
  assert.deepEqual(calls.find((call) => call[0] === "menu").slice(1), ["session.delete", "session"]);
  const resolved = calls.find((call) => call[0] === "menu-resolve")[1];
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].label, "删除会话…");
  assert.deepEqual(calls.find((call) => call[0] === "menu-resolve-empty")[1], []);
});

// ---------------------------------------------------------------- 包名一致性

await test("模块 id / typert 包名与 package.json 一致（scoped 安装的关键）", async () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const client = readFileSync(new URL("../client.js", import.meta.url), "utf8");
  const typert = readFileSync(new URL("../typert.host.js", import.meta.url), "utf8");
  assert.match(client, new RegExp(`id: "${pkg.name.replace(/[/@]/g, "\\$&")}"`));
  assert.ok(client.includes(`package: "${pkg.name}"`));
  assert.ok(typert.includes(`package: "${pkg.name}"`));
  assert.ok(client.includes(`"${pkg.name}#sessionTrash/list"`));
  assert.ok(typert.includes(`${pkg.name}#sessionTrash/`));
});

console.log(`\n${passed} passed`);
