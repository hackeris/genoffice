// sota-sqlite JS 适配层:把 sota_sqlite.c 的扁平函数表组装成 node:sqlite 形状
// (DatabaseSync/StatementSync)。原生 binding 由壳工程 shim 在窗口期前 dlopen 挂
// 到 globalThis(晚 dlopen 会崩,见 shim 桩⑫);C 侧细节见 sota_sqlite.c 文件头。
// 只实现文件索引用到的子集,方法集与 node:sqlite 对应子集语义一致。
const binding = globalThis.__sotaSqliteBinding;
if (!binding) {
  throw new Error("sota-sqlite: binding not preloaded (expected globalThis.__sotaSqliteBinding)");
}

class StatementSync {
  constructor(stmt) {
    this._stmt = stmt;
  }
  get(...params) {
    return binding.stmtGet(this._stmt, params);
  }
  all(...params) {
    return binding.stmtAll(this._stmt, params);
  }
  run(...params) {
    return binding.stmtRun(this._stmt, params);
  }
}

class DatabaseSync {
  constructor(path) {
    this._db = binding.open(path);
  }
  exec(sql) {
    binding.exec(this._db, sql);
  }
  prepare(sql) {
    return new StatementSync(binding.prepare(this._db, sql));
  }
  close() {
    binding.close(this._db);
  }
}

module.exports = { DatabaseSync, StatementSync };
