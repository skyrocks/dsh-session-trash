// Host 半：会话回收站。
//
// 删除一个会话不是"删一个文件"：日志目录、Workspace 的归档/置顶标记、派生缓存
// 分属不同 owner。这一层只负责接服务、串行化和暴露调用；真正的编排在
// session-ops.js（纯依赖注入，可单测），文件系统细节在 trash.js。
//
// 已知取舍：Workspace 注册表没有"移除成员槽位"的 API，删完后 workspace.json 里
// 可能留一个悬空 id。前端会把没有 summary 的 id 过滤掉，视觉无影响。
import z from "@deepseek-ai/schemastery";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import { removeSession, restoreSession } from "./session-ops.js";
import { createTrashStore, trashError } from "./trash.js";

const DEFAULT_RETENTION_DAYS = 0;

export const Config = z.object({
  /** >0 时，列出回收站会顺带清理超过 N 天的条目；0 = 永不自动清理。 */
  retentionDays: z.number().default(DEFAULT_RETENTION_DAYS),
  /** 回收站根目录；空 = <DSH_HOME>/trash/sessions。 */
  trashRoot: z.string().default("")
});

export class SessionTrashGateway extends TypertRemoteService {
  static inject = ["sessionPersistence", "workspaceRegistry", "sessions"];
  static Config = Config;

  constructor(ctx, config) {
    super(ctx, "sessionTrash");
    this.config = config ?? {};
    this.store = createTrashStore({
      root: typeof this.config.trashRoot === "string" && this.config.trashRoot.trim().length > 0 ? this.config.trashRoot : undefined
    });
    /** 所有写操作串行，避免两次删除/恢复互相交错。 */
    this.chain = Promise.resolve();
  }

  /** 串行化一次写操作。 */
  enqueue(task) {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => {});
    return next;
  }

  /** 取某个必需的服务；缺失时给出明确错误，而不是 undefined 崩溃。 */
  require(name) {
    const service = this.ctx.get(name);
    if (service === undefined) throw trashError("trash/unavailable", `当前组合缺少 ${name} 服务`);
    return service;
  }

  /** 列出回收站，必要时清理过期条目。 */
  async list() {
    const retentionDays = Number(this.config.retentionDays);
    const removed = await this.store.purgeExpired(Number.isFinite(retentionDays) ? retentionDays : 0);
    const { entries, skipped } = await this.store.list();
    return { root: this.store.root, entries, skipped, removed };
  }

  /** 删除一个会话：见 session-ops.removeSession。 */
  async delete(request) {
    const sessionId = typeof request?.sessionId === "string" ? request.sessionId : "";
    const title = typeof request?.title === "string" ? request.title : null;
    return this.enqueue(() =>
      removeSession({
        sessionId,
        title,
        persistence: this.require("sessionPersistence"),
        registry: this.require("workspaceRegistry"),
        sessions: this.require("sessions"),
        store: this.store,
        logger: this.ctx.logger
      })
    );
  }

  /** 从回收站恢复一个会话。 */
  async restore(request) {
    const trashId = typeof request?.trashId === "string" ? request.trashId : "";
    return this.enqueue(() =>
      restoreSession({
        trashId,
        store: this.store,
        registry: this.ctx.get("workspaceRegistry"),
        logger: this.ctx.logger
      })
    );
  }

  /** 彻底删除一条（不可恢复）。 */
  async purge(request) {
    const trashId = typeof request?.trashId === "string" ? request.trashId.trim() : "";
    if (trashId.length === 0) throw trashError("trash/invalid-id", "缺少回收站条目 id");
    return this.enqueue(async () => {
      const { removed } = await this.store.purge(trashId);
      return { ok: true, removed };
    });
  }

  /** 清空回收站。 */
  async purgeAll() {
    return this.enqueue(async () => {
      const removed = await this.store.purgeAll();
      return { ok: true, removed };
    });
  }
}

export default SessionTrashGateway;
