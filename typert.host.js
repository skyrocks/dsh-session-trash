// Typert Host 清单：声明 sessionTrash/{list,delete,restore,purge,purgeAll} 五个 direct 调用。
// 0.2.1 的 strict codec 必须是 `{ mode, typeSymbol, create() }`；这里不依赖 zod，
// 目录直装不会缺包。参数按 wire 名打包成对象传给 Host 方法。
//
// 一次删除 = 一个条目：根会话 + 它的 subagent 子会话（避免孤儿 lineage）。

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function fail(field, expected) {
  throw new Error(`dsh-session-trash ${field}: 需要 ${expected}`);
}

function string(field, value, { nullable = false } = {}) {
  if (nullable && value === null) return value;
  if (typeof value !== "string") fail(field, "字符串");
  return value;
}

function number(field, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(field, "有限数字");
  return value;
}

function boolean(field, value) {
  if (typeof value !== "boolean") fail(field, "布尔值");
  return value;
}

function codec(typeSymbol, parse) {
  return { mode: "strict", typeSymbol, create: () => ({ parse }) };
}

const result = (name, parse) => codec(`@skyrocks/dsh-session-trash#SessionTrash${name}Result`, parse);
const parameter = (name, parse) => ({
  name,
  wire: name,
  source: "json",
  codec: codec(`@skyrocks/dsh-session-trash#${name}`, parse)
});

function parseDeleteRequest(value) {
  if (!isRecord(value)) fail("delete request", "对象");
  string("request.sessionId", value.sessionId);
  if (value.title !== undefined && value.title !== null) string("request.title", value.title);
  return value;
}

function parseTrashIdRequest(value) {
  if (!isRecord(value)) fail("request", "对象");
  string("request.trashId", value.trashId);
  return value;
}

function parseSessionSpec(value) {
  if (!isRecord(value)) fail("entry.sessions[]", "对象");
  string("entry.sessions[].sessionId", value.sessionId);
  boolean("entry.sessions[].hasData", value.hasData);
  number("entry.sessions[].bytes", value.bytes);
  return value;
}

function parseEntry(value) {
  if (!isRecord(value)) fail("entry", "对象");
  string("entry.trashId", value.trashId);
  string("entry.rootSessionId", value.rootSessionId);
  number("entry.deletedAt", value.deletedAt);
  number("entry.bytes", value.bytes);
  if (!Array.isArray(value.sessions) || value.sessions.length === 0) fail("entry.sessions", "非空数组");
  for (const session of value.sessions) parseSessionSpec(session);
  return value;
}

function parseListResult(value) {
  if (!isRecord(value)) fail("list result", "对象");
  string("result.root", value.root);
  if (!Array.isArray(value.entries)) fail("result.entries", "数组");
  for (const entry of value.entries) parseEntry(entry);
  number("result.skipped", value.skipped);
  number("result.removed", value.removed);
  return value;
}

const parseDeleteResult = (value) => {
  if (!isRecord(value)) fail("delete result", "对象");
  boolean("result.ok", value.ok);
  string("result.trashId", value.trashId);
  string("result.rootSessionId", value.rootSessionId);
  if (!Array.isArray(value.sessionIds) || value.sessionIds.length === 0) fail("result.sessionIds", "非空数组");
  for (const id of value.sessionIds) string("result.sessionIds[]", id);
  number("result.bytes", value.bytes);
  boolean("result.hasData", value.hasData);
  return value;
};

const parseRestoreResult = (value) => {
  if (!isRecord(value)) fail("restore result", "对象");
  boolean("result.ok", value.ok);
  string("result.rootSessionId", value.rootSessionId);
  if (!Array.isArray(value.sessionIds) || value.sessionIds.length === 0) fail("result.sessionIds", "非空数组");
  for (const id of value.sessionIds) string("result.sessionIds[]", id);
  return value;
};

const parsePurgeResult = (value) => {
  if (!isRecord(value)) fail("purge result", "对象");
  boolean("result.ok", value.ok);
  boolean("result.removed", value.removed);
  return value;
};

const parsePurgeAllResult = (value) => {
  if (!isRecord(value)) fail("purgeAll result", "对象");
  boolean("result.ok", value.ok);
  number("result.removed", value.removed);
  return value;
};

const invocation = (method, parameters, parseResult) => ({
  id: `@skyrocks/dsh-session-trash#sessionTrash/${method}`,
  service: "sessionTrash",
  namespace: "sessionTrash",
  method,
  invocation: { kind: "direct" },
  parameters,
  result: result(`${method[0].toUpperCase()}${method.slice(1)}`, parseResult)
});

export const TYPERT = {
  package: "@skyrocks/dsh-session-trash",
  face: "host",
  schemas: [],
  invocations: [
    invocation("list", [], parseListResult),
    invocation("delete", [parameter("request", parseDeleteRequest)], parseDeleteResult),
    invocation("restore", [parameter("request", parseTrashIdRequest)], parseRestoreResult),
    invocation("purge", [parameter("request", parseTrashIdRequest)], parsePurgeResult),
    invocation("purgeAll", [], parsePurgeAllResult)
  ],
  model: { services: [], events: [], objects: [] }
};
