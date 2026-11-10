// 回收站存储层：纯文件系统逻辑，不依赖 Cordis / DSH 服务，方便单测。
//
// 一次删除 = 一个条目（父会话 + 它的 subagent 子会话一起走，避免留下孤儿 lineage）：
//   <root>/<deletedAt>-<rootSessionId>/meta.json
//   <root>/<deletedAt>-<rootSessionId>/sessions/<escaped-id>/…   ← 原会话目录整体搬进来
//
// 只做「搬进来 / 搬回去 / 删掉」三件事：
//   - 不碰 ~/.dsh 之外的东西；
//   - 恢复只依赖 meta.json 里记录的原路径，不依赖进程内存；
//   - 条目 id 做路径穿越校验；跨盘时退化为复制 + 删除。
import { mkdir, readdir, readFile, rename, rm, stat, writeFile, cp } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

/** 条目目录名：毫秒时间戳 + 转义后的根会话 id。 */
const ENTRY_ID = /^\d{10,16}-[A-Za-z0-9._-]{1,200}$/;

/**
 * 解析 DSH home：显式 $DSH_HOME 优先，与 dsh-home-paths 的约定一致。
 * @returns {string} 绝对路径
 */
export function dshHome() {
  const configured = typeof process.env.DSH_HOME === "string" ? process.env.DSH_HOME.trim() : "";
  return configured.length > 0 ? resolve(configured) : join(homedir(), ".dsh");
}

/** 默认回收站根目录。 */
export function defaultTrashRoot() {
  return join(dshHome(), "trash", "sessions");
}

/**
 * 把会话 id 转成可做目录名的片段。
 * @param {string} sessionId
 * @returns {string}
 */
export function escapeSessionId(sessionId) {
  const escaped = String(sessionId).replace(/[^A-Za-z0-9._-]/g, "_");
  return escaped.length > 0 ? escaped.slice(0, 200) : "session";
}

/**
 * 判断一个目录名是否是合法的回收站条目 id（同时挡掉路径穿越）。
 * @param {string} trashId
 * @returns {boolean}
 */
export function isEntryId(trashId) {
  return typeof trashId === "string" && ENTRY_ID.test(trashId);
}

/**
 * 递归统计目录字节数；目录不存在返回 0。
 * @param {string} directory
 * @returns {Promise<number>}
 */
export async function directorySize(directory) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(path);
    else if (entry.isFile()) {
      try {
        total += (await stat(path)).size;
      } catch {
        // 读不到大小就跳过，不影响删除动作。
      }
    }
  }
  return total;
}

/**
 * 移动文件或目录；跨设备（EXDEV）时退化为「复制 + 删除」。
 * @param {string} from
 * @param {string} to
 * @returns {Promise<void>}
 */
export async function movePath(from, to) {
  try {
    await rename(from, to);
    return;
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
  }
  await cp(from, to, { recursive: true, force: false, errorOnExist: true });
  await rm(from, { recursive: true, force: true });
}

/**
 * 给错误加上稳定 code，Client 端按 code 出提示。
 * @param {string} code
 * @param {string} message
 * @returns {Error}
 */
export function trashError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** 一条会话的搬运规格。 */
function normalizeSession(input) {
  const sessionId = String(input?.sessionId ?? "");
  if (sessionId.length === 0) throw trashError("trash/invalid-id", "缺少会话 id");
  const originalPath =
    typeof input.originalPath === "string" && input.originalPath.length > 0 ? resolve(input.originalPath) : null;
  if (originalPath !== null && !isAbsolute(originalPath)) {
    throw trashError("trash/invalid-path", `会话目录不是绝对路径：${originalPath}`);
  }
  return {
    sessionId,
    cwd: typeof input.cwd === "string" ? input.cwd : null,
    originalPath,
    wasArchived: input.wasArchived === true,
    wasPinned: input.wasPinned === true,
    bytes: 0,
    hasData: false
  };
}

/**
 * 创建回收站存储。
 * @param {{ root?: string }} [options]
 */
export function createTrashStore(options = {}) {
  const root = resolve(options.root && String(options.root).trim().length > 0 ? options.root : defaultTrashRoot());

  /** 条目路径，并保证它确实是 root 的直接子目录。 */
  function entryPath(trashId) {
    if (!isEntryId(trashId)) throw trashError("trash/invalid-id", `非法的回收站条目：${String(trashId)}`);
    const path = resolve(root, trashId);
    if (basename(path) !== trashId || !path.startsWith(root + sep)) {
      throw trashError("trash/invalid-id", `回收站条目越界：${String(trashId)}`);
    }
    return path;
  }

  async function readMeta(trashId) {
    const path = join(entryPath(trashId), "meta.json");
    let raw;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      throw trashError("trash/not-found", `回收站里没有这一条：${trashId}`);
    }
    let meta;
    try {
      meta = JSON.parse(raw);
    } catch {
      throw trashError("trash/corrupt", `回收站条目损坏：${trashId}`);
    }
    if (meta === null || typeof meta !== "object" || !Array.isArray(meta.sessions) || meta.sessions.length === 0) {
      throw trashError("trash/corrupt", `回收站条目损坏：${trashId}`);
    }
    return { ...meta, trashId };
  }

  return {
    root,

    /** 首次写入时创建根目录（不预建空目录）。 */
    async ensure() {
      await mkdir(root, { recursive: true, mode: 0o700 });
    },

    /**
     * 列出现有条目，最新删除的在前。坏条目跳过，不阻塞列表。
     * @returns {Promise<{ entries: object[], skipped: number }>}
     */
    async list() {
      let names;
      try {
        names = await readdir(root, { withFileTypes: true });
      } catch {
        return { entries: [], skipped: 0 };
      }
      const entries = [];
      let skipped = 0;
      for (const dirent of names) {
        if (!dirent.isDirectory() || !isEntryId(dirent.name)) continue;
        try {
          entries.push(await readMeta(dirent.name));
        } catch {
          skipped += 1;
        }
      }
      entries.sort((a, b) => (Number(b.deletedAt) || 0) - (Number(a.deletedAt) || 0));
      return { entries, skipped };
    },

    /** 读一条元数据。 */
    get: readMeta,

    /**
     * 把一次删除涉及的全部会话目录搬进回收站。
     * @param {{ rootSessionId: string, title?: string|null, deletedAt?: number,
     *           sessions: Array<{ sessionId: string, cwd?: string|null, originalPath?: string|null,
     *                              wasArchived?: boolean, wasPinned?: boolean }> }} input
     * @returns {Promise<object>} 写入的元数据（含 trashId）
     */
    async add(input) {
      const rootSessionId = String(input?.rootSessionId ?? "");
      if (rootSessionId.length === 0) throw trashError("trash/invalid-id", "缺少会话 id");
      if (!Array.isArray(input?.sessions) || input.sessions.length === 0) {
        throw trashError("trash/invalid-id", "没有要搬运的会话");
      }

      const deletedAt = Number.isFinite(input.deletedAt) ? Number(input.deletedAt) : Date.now();
      const trashId = `${deletedAt}-${escapeSessionId(rootSessionId)}`;
      const directory = entryPath(trashId);
      const sessions = input.sessions.map(normalizeSession);

      await mkdir(directory, { recursive: true, mode: 0o700 });
      try {
        for (const session of sessions) {
          if (session.originalPath === null) continue;
          if (!(await pathExists(session.originalPath))) {
            throw trashError("trash/missing-source", `找不到会话目录：${session.originalPath}`);
          }
          const bytes = await directorySize(session.originalPath);
          const target = join(directory, "sessions", escapeSessionId(session.sessionId));
          await mkdir(dirname(target), { recursive: true, mode: 0o700 });
          await movePath(session.originalPath, target);
          session.bytes = bytes;
          session.hasData = true;
        }
      } catch (error) {
        // 中途失败：把已经搬进来的搬回去，不在回收站里留半条记录。
        const moved = sessions.filter((session) => session.hasData);
        for (const session of moved) {
          const target = join(directory, "sessions", escapeSessionId(session.sessionId));
          try {
            await movePath(target, session.originalPath);
          } catch {
            // 回滚失败时保留现场，交给人工处理。
          }
        }
        await rm(directory, { recursive: true, force: true });
        throw error;
      }

      const meta = {
        rootSessionId,
        title: typeof input.title === "string" && input.title.trim().length > 0 ? input.title.trim() : null,
        cwd: typeof input.cwd === "string" ? input.cwd : null,
        deletedAt,
        bytes: sessions.reduce((total, session) => total + session.bytes, 0),
        sessions
      };
      await writeFile(join(directory, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
      return { ...meta, trashId };
    },

    /**
     * 恢复一条：把每个 session/ 搬回原路径，然后删掉条目目录。
     * 调用方负责重新打归档 / 置顶标记。
     * @param {string} trashId
     * @returns {Promise<object>} 原元数据
     */
    async restore(trashId) {
      const meta = await readMeta(trashId);
      const directory = entryPath(trashId);

      // 先整体预检：任何一个目标被占用就整条中止，避免只恢复一半。
      const plans = [];
      for (const session of meta.sessions) {
        const dataPath = join(directory, "sessions", escapeSessionId(session.sessionId));
        const hasData = await pathExists(dataPath);
        if (!hasData) continue;
        const originalPath = session.originalPath;
        if (typeof originalPath !== "string" || !isAbsolute(originalPath)) {
          throw trashError("trash/corrupt", `回收站条目缺少原路径：${session.sessionId}`);
        }
        if (await pathExists(resolve(originalPath))) {
          throw trashError("trash/restore-conflict", "原位置已经有同名目录，无法恢复");
        }
        plans.push({ dataPath, target: resolve(originalPath) });
      }

      for (const plan of plans) {
        await mkdir(dirname(plan.target), { recursive: true });
        await movePath(plan.dataPath, plan.target);
      }
      await rm(directory, { recursive: true, force: true });
      return meta;
    },

    /**
     * 彻底删除一条。
     * @param {string} trashId
     * @returns {Promise<{ removed: boolean, meta: object|null }>}
     */
    async purge(trashId) {
      const directory = entryPath(trashId);
      let meta = null;
      try {
        meta = await readMeta(trashId);
      } catch (error) {
        if (error?.code === "trash/not-found") return { removed: false, meta: null };
      }
      await rm(directory, { recursive: true, force: true });
      return { removed: true, meta };
    },

    /**
     * 清空回收站。
     * @returns {Promise<number>} 删除的条目数
     */
    async purgeAll() {
      const { entries } = await this.list();
      for (const entry of entries) await rm(entryPath(entry.trashId), { recursive: true, force: true });
      return entries.length;
    },

    /**
     * 清理超过保留期的条目。
     * @param {number} days
     * @returns {Promise<number>} 删除的条目数
     */
    async purgeExpired(days) {
      if (!(Number.isFinite(days) && days > 0)) return 0;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const { entries } = await this.list();
      let removed = 0;
      for (const entry of entries) {
        const deletedAt = Number(entry.deletedAt);
        if (!Number.isFinite(deletedAt) || deletedAt > cutoff) continue;
        await rm(entryPath(entry.trashId), { recursive: true, force: true });
        removed += 1;
      }
      return removed;
    }
  };
}
