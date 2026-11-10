// 删除 / 恢复的编排逻辑：只依赖注入进来的服务对象，不依赖 Cordis 上下文，
// 因此可以用假服务直接单测（见 test/session-ops.test.mjs）。
//
// 不变式：
//   1. 会话（含它的 subagent 子会话）在内存里活着 → 不删；
//   2. subagent 子会话跟着父会话一起走，不留孤儿 lineage；
//   3. 写操作前先归档：归档自带「有没有运行中的工作」检查，失败则整体回滚；
//   4. 先搬文件、再清标记；文件搬失败就保持原状。
import { dirname } from "node:path";

import { trashError } from "./trash.js";

const MAX_TITLE = 200;

/** 把 WorkspaceActiveSessionError 压成一行可读中文。 */
export function describeActivity(error) {
  const activity = Array.isArray(error?.activity) ? error.activity : [];
  if (activity.length === 0) return "该会话还有正在运行的工作";
  const parts = activity.map((entry) => {
    const items = Array.isArray(entry?.items) ? entry.items : [];
    const labels = items
      .map((item) => (typeof item?.label === "string" && item.label.length > 0 ? item.label : item?.id))
      .filter((label) => typeof label === "string");
    const name =
      entry?.kind === "turn" ? "进行中的回合"
      : entry?.kind === "subagent" ? "子会话"
      : entry?.kind === "job" ? "后台任务"
      : entry?.kind === "schedule" ? "定时任务"
      : String(entry?.kind ?? "工作");
    return labels.length > 0 ? `${name}：${labels.join("、")}` : name;
  });
  return `该会话还有正在运行的工作（${parts.join("；")}）。先停止它，或等它结束后再删除。`;
}

/**
 * 根会话 + 它的 subagent 后代。只沿 `origin === 'subagent'` 的 header 走，
 * fork 出来的会话算独立会话，不会被带走。
 * @param {Array<{ header?: object }>} snapshots
 * @param {string} rootId
 * @returns {string[]} 根在前的 id 列表
 */
export function lineageOf(snapshots, rootId) {
  const children = new Map();
  for (const item of snapshots) {
    const header = item?.header;
    if (header?.origin !== "subagent" || typeof header.parentSession !== "string") continue;
    const list = children.get(header.parentSession);
    if (list === undefined) children.set(header.parentSession, [header.id]);
    else list.push(header.id);
  }
  const ordered = [];
  const seen = new Set();
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (typeof id !== "string" || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
    for (const child of children.get(id) ?? []) queue.push(child);
  }
  return ordered;
}

/** 归档一个会话，并把活动冲突翻译成稳定 code。 */
async function ensureArchived(registry, sessionId) {
  try {
    await registry.archiveSession(sessionId);
  } catch (error) {
    if (error?.name === "WorkspaceActiveSessionError") throw trashError("session/active", describeActivity(error));
    throw error;
  }
}

/**
 * 删除一个会话及其 subagent 子会话：校验 → 归档 → 搬入回收站 → 清标记。
 * @param {{ sessionId: string, title?: string|null, persistence: object, registry: object,
 *           sessions: object, store: object, logger?: object }} deps
 * @returns {Promise<{ ok: true, trashId: string, rootSessionId: string, sessionIds: string[],
 *                     bytes: number, hasData: boolean }>}
 */
export async function removeSession({ sessionId, title, persistence, registry, sessions, store, logger }) {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) throw trashError("trash/invalid-id", "缺少会话 id");
  const rootId = sessionId.trim();
  const displayTitle = typeof title === "string" && title.trim().length > 0 ? title.trim().slice(0, MAX_TITLE) : null;

  const snapshots = await persistence.list();
  const byId = new Map(snapshots.map((item) => [item?.header?.id, item]));
  const rootSnapshot = byId.get(rootId);
  if (rootSnapshot === undefined) throw trashError("session/unknown", "找不到这个会话的日志，可能已经被删除。");

  const ids = lineageOf(snapshots, rootId);

  for (const id of ids) {
    if (sessions.get?.(id) !== undefined) {
      throw trashError("session/live", "这个会话（或它的子会话）正在本机打开着。先切到别的会话（或重启 DSH）再删除。");
    }
  }

  /** @type {Map<string, { archived: boolean, pinned: boolean }>} */
  const state = new Map();
  for (const id of ids) {
    state.set(id, {
      archived: registry.archivedSessionIds.includes(id),
      pinned: registry.pinnedSessionIds.includes(id)
    });
  }

  const newlyArchived = [];
  try {
    for (const id of ids) {
      if (state.get(id).archived) continue;
      await ensureArchived(registry, id);
      newlyArchived.push(id);
    }
  } catch (error) {
    for (const id of newlyArchived) {
      try {
        await registry.unarchiveSession(id);
      } catch {
        // 回滚尽力而为。
      }
    }
    throw error;
  }

  const specs = ids.map((id) => {
    const snapshot = byId.get(id) ?? {};
    const path = snapshot.location?.path;
    return {
      sessionId: id,
      cwd: typeof snapshot.header?.cwd === "string" ? snapshot.header.cwd : null,
      originalPath: typeof path === "string" && path.length > 0 ? dirname(path) : null,
      wasArchived: state.get(id).archived,
      wasPinned: state.get(id).pinned
    };
  });

  const meta = await store.add({
    rootSessionId: rootId,
    title: displayTitle,
    cwd: typeof rootSnapshot.header?.cwd === "string" ? rootSnapshot.header.cwd : null,
    sessions: specs
  });

  // 文件已经安全进回收站，再清标记；任何一步失败都不该让删除整体失败。
  // 归档标记一律清掉（未归档的会话上面刚被归档，也要还原回去）；
  // 恢复时再按每条会话的原状态决定是否补回。
  try {
    for (const id of ids) {
      await registry.unarchiveSession(id);
      if (state.get(id).pinned) await registry.unpinSession(id);
    }
  } catch (error) {
    logger?.warn?.(`session-trash: 清理归档/置顶标记失败（${rootId}）：${String(error)}`);
  }

  return {
    ok: true,
    trashId: meta.trashId,
    rootSessionId: rootId,
    sessionIds: ids,
    bytes: meta.bytes,
    hasData: meta.sessions.some((session) => session.hasData === true)
  };
}

/**
 * 从回收站恢复一个条目（父会话 + 子会话一起回去），并按原状态补回归档 / 置顶标记。
 * @param {{ trashId: string, store: object, registry?: object, logger?: object }} deps
 * @returns {Promise<{ ok: true, rootSessionId: string, sessionIds: string[] }>}
 */
export async function restoreSession({ trashId, store, registry, logger }) {
  if (typeof trashId !== "string" || trashId.trim().length === 0) throw trashError("trash/invalid-id", "缺少回收站条目 id");
  const meta = await store.restore(trashId.trim());
  if (registry !== undefined) {
    for (const session of meta.sessions) {
      try {
        if (session.wasArchived === true) await registry.archiveSession(session.sessionId);
        if (session.wasPinned === true) await registry.pinSession(session.sessionId);
      } catch (error) {
        logger?.warn?.(`session-trash: 恢复归档/置顶标记失败（${session.sessionId}）：${String(error)}`);
      }
    }
  }
  return { ok: true, rootSessionId: meta.rootSessionId, sessionIds: meta.sessions.map((session) => session.sessionId) };
}
