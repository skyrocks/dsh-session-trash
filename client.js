// Client 半：右键「删除会话…」→ 确认 → 移入回收站；toast 可即时撤销；
// 「设置 → 回收站」里恢复或彻底删除。
//
// 手写 lazy-CJS bundle：脚本执行时只注册 factory，模块体在 materialize 时才运行。
// 只依赖 React 与 DSH 既有服务（slots / remote / contextMenus / sessions），
// 不引入 primitives，避免跨包版本耦合。
window.__ModuleLoader__.load({
  id: "@skyrocks/dsh-session-trash",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");

    // Client 只声明调用形状；真正的校验在 Host 侧完成，这里直通。
    const passThrough = () => ({ parse: (value) => value });
    const codec = (typeSymbol) => ({ mode: "strict", typeSymbol, create: passThrough });
    const parameter = (name) => ({ name, wire: name, source: "json", codec: codec(`@skyrocks/dsh-session-trash#${name}`) });

    const REMOTE = {
      package: "@skyrocks/dsh-session-trash",
      descriptors: [
        {
          id: "@skyrocks/dsh-session-trash#sessionTrash/list",
          service: "sessionTrash",
          namespace: "sessionTrash",
          method: "list",
          invocation: { kind: "direct" },
          parameters: [],
          result: codec("@skyrocks/dsh-session-trash#SessionTrashListResult")
        },
        {
          id: "@skyrocks/dsh-session-trash#sessionTrash/delete",
          service: "sessionTrash",
          namespace: "sessionTrash",
          method: "delete",
          invocation: { kind: "direct" },
          parameters: [parameter("request")],
          result: codec("@skyrocks/dsh-session-trash#SessionTrashDeleteResult")
        },
        {
          id: "@skyrocks/dsh-session-trash#sessionTrash/restore",
          service: "sessionTrash",
          namespace: "sessionTrash",
          method: "restore",
          invocation: { kind: "direct" },
          parameters: [parameter("request")],
          result: codec("@skyrocks/dsh-session-trash#SessionTrashRestoreResult")
        },
        {
          id: "@skyrocks/dsh-session-trash#sessionTrash/purge",
          service: "sessionTrash",
          namespace: "sessionTrash",
          method: "purge",
          invocation: { kind: "direct" },
          parameters: [parameter("request")],
          result: codec("@skyrocks/dsh-session-trash#SessionTrashPurgeResult")
        },
        {
          id: "@skyrocks/dsh-session-trash#sessionTrash/purgeAll",
          service: "sessionTrash",
          namespace: "sessionTrash",
          method: "purgeAll",
          invocation: { kind: "direct" },
          parameters: [],
          result: codec("@skyrocks/dsh-session-trash#SessionTrashPurgeAllResult")
        }
      ]
    };

    const CSS = [
      ".dsh-st-overlay{position:fixed;inset:0;z-index:2200;pointer-events:auto;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.38);}",
      ".dsh-st-dialog{width:min(440px,100%);border-radius:12px;background:var(--dsw-alias-bg-module-platform,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));box-shadow:0 18px 48px rgba(0,0,0,.26);color:var(--dsw-alias-label-primary,#1f2329);padding:18px 18px 14px;}",
      ".dsh-st-dialog h2{margin:0 0 8px;font-size:14px;font-weight:600;}",
      ".dsh-st-dialog p{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#6b7280);}",
      ".dsh-st-dialog .dsh-st-note{margin-top:8px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#8a8f98);}",
      ".dsh-st-error{margin-top:10px;padding:8px 10px;border-radius:8px;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-state-error-primary,#e5484d);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 10%,transparent);}",
      ".dsh-st-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;}",
      ".dsh-st-btn{height:30px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:transparent;color:inherit;font-size:12px;cursor:pointer;}",
      ".dsh-st-btn:hover{background:color-mix(in srgb,currentColor 8%,transparent);}",
      ".dsh-st-btn:disabled{opacity:.5;cursor:default;}",
      ".dsh-st-btn.is-danger{color:#fff;background:var(--dsw-alias-state-error-primary,#e5484d);border-color:transparent;}",
      ".dsh-st-btn.is-danger:hover{filter:brightness(1.05);}",
      ".dsh-st-btn.is-link{padding:0 6px;height:24px;border-color:transparent;font-size:11.5px;color:var(--dsw-alias-state-business-primary,#4d6bfe);}",
      ".dsh-st-section{display:flex;flex-direction:column;gap:12px;padding:4px 2px 24px;}",
      ".dsh-st-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;}",
      ".dsh-st-head h3{margin:0;font-size:13px;font-weight:600;}",
      ".dsh-st-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f98);word-break:break-all;}",
      ".dsh-st-list{display:flex;flex-direction:column;gap:1px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));border-radius:10px;overflow:hidden;background:var(--dsw-alias-border-l1,rgba(127,127,127,.18));}",
      ".dsh-st-row{display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--dsw-alias-bg-module-platform,#fff);}",
      ".dsh-st-row-main{flex:1;min-width:0;}",
      ".dsh-st-row-title{font-size:12.5px;color:var(--dsw-alias-label-primary,#1f2329);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".dsh-st-row-sub{margin-top:2px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f98);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".dsh-st-row-actions{display:flex;gap:2px;flex:none;}",
      ".dsh-st-empty{padding:28px 12px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a8f98);}",
      ".dsh-st-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f98);}"
    ].join("");

    /** 右键菜单里的垃圾桶字形：16px、跟随 currentColor，不引入 primitives 依赖。 */
    function TrashGlyph() {
      return React.createElement(
        "svg",
        {
          width: 16,
          height: 16,
          viewBox: "0 0 16 16",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.3,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
          focusable: "false",
          style: { display: "block" }
        },
        React.createElement("path", { d: "M2.8 4.6h10.4" }),
        React.createElement("path", { d: "M6.1 4.6V3.4c0-.5.4-.9.9-.9h1.9c.5 0 .9.4.9.9v1.2" }),
        React.createElement("path", { d: "M4.4 4.6v8.1c0 .8.6 1.4 1.4 1.4h4.4c.8 0 1.4-.6 1.4-1.4V4.6" }),
        React.createElement("path", { d: "M6.7 7.4v3.4" }),
        React.createElement("path", { d: "M9.3 7.4v3.4" })
      );
    }

    function ensureStyle() {
      if (typeof document === "undefined") return () => {};
      const id = "dsh-session-trash-style";
      if (document.getElementById(id) !== null) return () => {};
      const element = document.createElement("style");
      element.id = id;
      element.textContent = CSS;
      document.head.appendChild(element);
      return () => {
        element.remove();
      };
    }

    /** 共享快照：确认框请求 + 回收站版本号。 */
    function createStore(initial) {
      const listeners = new Set();
      let value = initial;
      return {
        get: () => value,
        set(next) {
          value = next;
          for (const listener of listeners) listener();
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        }
      };
    }

    function useStore(store) {
      return React.useSyncExternalStore(store.subscribe, store.get, store.get);
    }

    const confirmStore = createStore(null);
    const revisionStore = createStore(0);
    const bumpRevision = () => revisionStore.set(revisionStore.get() + 1);

    function formatBytes(bytes) {
      if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
      const units = ["B", "KB", "MB", "GB"];
      let value = bytes;
      let unit = 0;
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
      }
      return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
    }

    function formatTime(ms) {
      if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
      const date = new Date(ms);
      const pad = (n) => String(n).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    let ctxRef = null;
    let mountReady = Promise.resolve();

    async function call(method, argument) {
      await mountReady;
      const remote = ctxRef === null ? undefined : ctxRef.get("remote.sessionTrash");
      if (remote === undefined || remote === null) throw new Error("会话回收站服务不可用（Host 未加载）");
      const result = argument === undefined ? await remote[method]() : await remote[method](argument);
      if (!result || result.ok === false) {
        const reason = result && result.error ? result.error.message || String(result.error) : "操作失败，请重试";
        throw new Error(reason);
      }
      return result.value;
    }

    /** 删/恢复之后让侧栏会话列表重新对账（没有 remove 事件，只能主动拉）。 */
    function refreshSessions() {
      try {
        const sessions = ctxRef === null ? undefined : ctxRef.get("sessions");
        if (sessions !== undefined && typeof sessions.refresh === "function") sessions.refresh();
      } catch {
        // 列表刷新失败不影响删除本身。
      }
    }

    function notify(text, success, action) {
      try {
        const menus = ctxRef === null ? undefined : ctxRef.get("contextMenus");
        if (menus !== undefined && typeof menus.notify === "function") menus.notify(text, success, action);
      } catch {
        // toast 不可用就静默；操作已经完成。
      }
    }

    function askDelete(sessionId, title) {
      confirmStore.set({ sessionId, title: typeof title === "string" ? title : "" });
    }

    async function restoreEntry(trashId, options = {}) {
      const value = await call("restore", { trashId });
      refreshSessions();
      bumpRevision();
      if (options.quiet !== true) {
        const count = Array.isArray(value.sessionIds) ? value.sessionIds.length : 1;
        notify(count > 1 ? `已恢复 ${count} 个会话` : "已从回收站恢复", true);
      }
      return value;
    }

    /** 确认框本体：只有存在请求时渲染。 */
    function DeleteConfirmDialog() {
      const request = useStore(confirmStore);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);

      React.useEffect(() => {
        if (request === null) {
          setBusy(false);
          setError(null);
        }
      }, [request]);

      React.useEffect(() => {
        if (request === null || typeof document === "undefined") return undefined;
        const onKey = (event) => {
          if (event.key === "Escape" && !busy) confirmStore.set(null);
        };
        document.addEventListener("keydown", onKey);
        return () => {
          document.removeEventListener("keydown", onKey);
        };
      }, [request, busy]);

      if (request === null) return null;
      const close = () => {
        if (!busy) confirmStore.set(null);
      };
      const confirm = async () => {
        setBusy(true);
        setError(null);
        try {
          const value = await call("delete", { sessionId: request.sessionId, title: request.title });
          confirmStore.set(null);
          refreshSessions();
          bumpRevision();
          const count = Array.isArray(value.sessionIds) ? value.sessionIds.length : 1;
          notify(count > 1 ? `已移入回收站（含 ${count - 1} 个子会话）` : "已移入回收站", true, {
            label: "撤销",
            run: () => restoreEntry(value.trashId),
            failureLabel: "撤销失败，请到 设置 → 回收站 恢复"
          });
        } catch (failure) {
          setBusy(false);
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      };

      const name = typeof request.title === "string" && request.title.trim().length > 0 ? request.title.trim() : "这个会话";
      return React.createElement(
        "div",
        {
          className: "dsh-st-overlay",
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) close();
          }
        },
        React.createElement(
          "div",
          { className: "dsh-st-dialog", role: "dialog", "aria-modal": "true", "aria-label": "删除会话" },
          React.createElement("h2", null, "删除会话"),
          React.createElement("p", null, `「${name}」会从侧栏移除（连同它的子会话），并移入回收站。`),
          React.createElement("p", { className: "dsh-st-note" }, "移动后可以点提示里的「撤销」，也可以在「设置 → 回收站」里恢复。回收站占用磁盘空间，清空后才真正删除。"),
          error !== null ? React.createElement("div", { className: "dsh-st-error", role: "alert" }, error) : null,
          React.createElement(
            "div",
            { className: "dsh-st-actions" },
            React.createElement("button", { type: "button", className: "dsh-st-btn", disabled: busy, onClick: close }, "取消"),
            React.createElement("button", { type: "button", className: "dsh-st-btn is-danger", disabled: busy, onClick: confirm }, busy ? "删除中…" : "移入回收站")
          )
        )
      );
    }

    /** 设置 → 回收站。 */
    function TrashSection() {
      const revision = useStore(revisionStore);
      const [state, setState] = React.useState({ status: "loading", root: "", entries: [], error: null, removed: 0 });
      const [busyId, setBusyId] = React.useState(null);
      const [confirmClear, setConfirmClear] = React.useState(false);

      const load = React.useCallback(async () => {
        setState((current) => ({ ...current, status: "loading", error: null }));
        try {
          const value = await call("list");
          setState({ status: "ready", root: value.root, entries: Array.isArray(value.entries) ? value.entries : [], error: null, removed: value.removed ?? 0 });
        } catch (failure) {
          setState({ status: "error", root: "", entries: [], error: failure instanceof Error ? failure.message : String(failure), removed: 0 });
        }
      }, []);

      React.useEffect(() => {
        load();
      }, [load, revision]);

      const restore = async (entry) => {
        setBusyId(entry.trashId);
        try {
          await restoreEntry(entry.trashId, { quiet: true });
          notify(`「${entry.title || entry.rootSessionId}」已恢复`, true);
        } catch (failure) {
          notify(failure instanceof Error ? failure.message : String(failure), false);
        } finally {
          setBusyId(null);
        }
      };

      const purge = async (entry) => {
        setBusyId(entry.trashId);
        try {
          await call("purge", { trashId: entry.trashId });
          bumpRevision();
          notify("已彻底删除", true);
        } catch (failure) {
          notify(failure instanceof Error ? failure.message : String(failure), false);
        } finally {
          setBusyId(null);
        }
      };

      const purgeAll = async () => {
        if (!confirmClear) {
          setConfirmClear(true);
          return;
        }
        setConfirmClear(false);
        setBusyId("*");
        try {
          const value = await call("purgeAll");
          bumpRevision();
          notify(`已清空回收站（${value.removed} 项）`, true);
        } catch (failure) {
          notify(failure instanceof Error ? failure.message : String(failure), false);
        } finally {
          setBusyId(null);
        }
      };

      const entries = state.entries;
      return React.createElement(
        "div",
        { className: "dsh-st-section" },
        React.createElement(
          "div",
          { className: "dsh-st-head" },
          React.createElement("h3", null, "回收站"),
          React.createElement(
            "div",
            { className: "dsh-st-meta" },
            state.root.length > 0 ? state.root : "",
            state.removed > 0 ? ` · 已清理 ${state.removed} 个过期条目` : ""
          )
        ),
        state.status === "loading"
          ? React.createElement("div", { className: "dsh-st-empty" }, "读取中…")
          : state.status === "error"
            ? React.createElement("div", { className: "dsh-st-error", role: "alert" }, state.error)
            : entries.length === 0
              ? React.createElement("div", { className: "dsh-st-empty" }, "回收站是空的。删除会话后会出现在这里。")
              : React.createElement(
                  "div",
                  { className: "dsh-st-list" },
                  entries.map((entry) =>
                    React.createElement(
                      "div",
                      { className: "dsh-st-row", key: entry.trashId },
                      React.createElement(
                        "div",
                        { className: "dsh-st-row-main" },
                        React.createElement("div", { className: "dsh-st-row-title" }, entry.title || entry.rootSessionId),
                        React.createElement(
                          "div",
                          { className: "dsh-st-row-sub" },
                          [
                            formatTime(entry.deletedAt),
                            formatBytes(entry.bytes),
                            entry.sessions.length > 1 ? `含 ${entry.sessions.length - 1} 个子会话` : null,
                            entry.sessions.some((session) => session.wasArchived === true) ? "恢复后仍归档" : null
                          ]
                            .filter((part) => part !== null)
                            .join(" · ")
                        )
                      ),
                      React.createElement(
                        "div",
                        { className: "dsh-st-row-actions" },
                        React.createElement(
                          "button",
                          {
                            type: "button",
                            className: "dsh-st-btn is-link",
                            disabled: busyId !== null,
                            onClick: () => restore(entry)
                          },
                          busyId === entry.trashId ? "恢复中…" : "恢复"
                        ),
                        React.createElement(
                          "button",
                          {
                            type: "button",
                            className: "dsh-st-btn is-link",
                            disabled: busyId !== null,
                            onClick: () => purge(entry)
                          },
                          "彻底删除"
                        )
                      )
                    )
                  )
                ),
        React.createElement(
          "div",
          { className: "dsh-st-footer" },
          React.createElement("span", null, "恢复只把目录搬回原位；FTS 索引会在下次搜索时自动补回。"),
          entries.length > 0
            ? React.createElement(
                "button",
                {
                  type: "button",
                  className: confirmClear ? "dsh-st-btn is-danger" : "dsh-st-btn",
                  disabled: busyId !== null,
                  onClick: purgeAll,
                  onBlur: () => setConfirmClear(false)
                },
                confirmClear ? "确认清空？" : "清空回收站"
              )
            : null
        )
      );
    }

    function apply(ctx) {
      ctxRef = ctx;
      mountReady = ctx.remote.$mount(REMOTE);
      const slots = ctx.get("slots");
      if (slots === undefined) return;
      ctx.effect(() => ensureStyle());

      slots.inject("shell.overlay", () =>
        slots.register({ name: "shell.overlay", id: "session-trash-confirm", order: 60 }, DeleteConfirmDialog)
      );
      slots.inject("contextMenu.icon", () =>
        slots.register({ name: "contextMenu.icon", key: "session-trash.delete" }, TrashGlyph)
      );
      slots.inject("settings.section", () =>
        slots.register({ name: "settings.section", id: "session-trash", order: 40, label: () => "回收站" }, TrashSection)
      );

      const menus = ctx.get("contextMenus");
      if (menus === undefined) {
        console.warn("dsh-session-trash: contextMenus 服务不可用，右键菜单未注册");
        return;
      }
      ctx.effect(() =>
        menus.register({
          id: "session.delete",
          target: "session",
          order: 650,
          resolve: (target) => {
            const sessionId = typeof target?.sessionId === "string" ? target.sessionId : "";
            if (sessionId.length === 0) return [];
            return [
              {
                id: "delete",
                label: "删除会话…",
                icon: { key: "session-trash.delete" },
                danger: true,
                separatorBefore: true,
                afterContent: true,
                run: () => askDelete(sessionId, target?.displayTitle)
              }
            ];
          }
        })
      );
    }

    exports.apply = apply;
    exports.inject = ["slots", "remote"];
    return module.exports;
  }
});
