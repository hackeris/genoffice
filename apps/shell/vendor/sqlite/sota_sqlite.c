// sota_sqlite.c —— node:sqlite 兼容的纯 C NAPI 绑定(store.ts 所需子集)
//
// 为什么存在:鸿蒙 Electron fork(Node 22.17)未编入 node:sqlite;C++ addon 路线
// 被引擎缺陷封死(OHOS 上 libace_napi.z.so 恒载同名 napi_* 符号,链接期重定位被
// interpose,ace_napi 收到 Node env 即 abort——见 fork 源 js_native_api.h 的
// OSOHOS 段与 docs/appendix/C-hos-vscodium-runtime.md §7)。解法 = xlsx-launcher
// 实证配方:全部 napi_* 经 dlsym 从 libelectron.so 解析(probe.c 真机全绿验证);
// sqlite3 本体直接把 amalgamation 编进本 addon(内部符号,无劫持面)。
//
// 覆盖的 API 面(与 node:sqlite 语义对齐,超出子集不支持):
//   new DatabaseSync(path)      → open_v2 READWRITE|CREATE|FULLMUTEX
//   db.exec(sql)                → sqlite3_exec(多语句)
//   db.prepare(sql)             → sqlite3_prepare_v2 → StatementSync
//   stmt.get(...params)         → reset→bind→step 一次;无行返回 undefined
//   stmt.all(...params)         → 同上,收集全部行
//   stmt.run(...params)         → { changes, lastInsertRowid }
// 参数绑定:null / number(整数值→int64,否则 double)/ string;行取值:
//   INTEGER→number(2^53 内;超出精度即失真,文件索引值域内不触)/ FLOAT→number /
//   TEXT→string / NULL→null;BLOB 不支持(受控调用方不产生)。
// 生命周期:db/stmt 都是 napi external + finalizer(sqlite3_close_v2 /
// sqlite3_finalize,顺序无关皆安全);显式 close 置 closed 标志防重复关。
#include <dlfcn.h>
#include <math.h>
#include <sqlite3.h>
#include <stdlib.h>
#include <string.h>

#include <node_api.h>

// ---- napi 函数表(dlsym,勿改回链接期符号——见文件头)----
static __typeof__(napi_create_function) *p_napi_create_function;
static __typeof__(napi_set_named_property) *p_napi_set_named_property;
static __typeof__(napi_get_cb_info) *p_napi_get_cb_info;
static __typeof__(napi_throw_error) *p_napi_throw_error;
static __typeof__(napi_create_string_utf8) *p_napi_create_string_utf8;
static __typeof__(napi_get_value_string_utf8) *p_napi_get_value_string_utf8;
static __typeof__(napi_create_object) *p_napi_create_object;
static __typeof__(napi_create_double) *p_napi_create_double;
static __typeof__(napi_create_int64) *p_napi_create_int64;
static __typeof__(napi_get_value_double) *p_napi_get_value_double;
static __typeof__(napi_get_null) *p_napi_get_null;
static __typeof__(napi_get_undefined) *p_napi_get_undefined;
static __typeof__(napi_create_array) *p_napi_create_array;
static __typeof__(napi_set_element) *p_napi_set_element;
static __typeof__(napi_get_element) *p_napi_get_element;
static __typeof__(napi_get_array_length) *p_napi_get_array_length;
static __typeof__(napi_typeof) *p_napi_typeof;
static __typeof__(napi_create_external) *p_napi_create_external;
static __typeof__(napi_get_value_external) *p_napi_get_value_external;

static bool resolve_napi(void) {
  // 主进程内 libelectron.so 必已装载;NOLOAD 只取句柄不重复加载
  void *h = dlopen("libelectron.so", RTLD_LAZY | RTLD_LOCAL | RTLD_NOLOAD);
  if (!h) h = dlopen("libelectron.so", RTLD_NOW | RTLD_LOCAL);
  if (!h) return false;
#define RESOLVE(f) \
  p_##f = dlsym(h, #f); \
  if (!p_##f) return false;
  RESOLVE(napi_create_function)
  RESOLVE(napi_set_named_property)
  RESOLVE(napi_get_cb_info)
  RESOLVE(napi_throw_error)
  RESOLVE(napi_create_string_utf8)
  RESOLVE(napi_get_value_string_utf8)
  RESOLVE(napi_create_object)
  RESOLVE(napi_create_double)
  RESOLVE(napi_create_int64)
  RESOLVE(napi_get_value_double)
  RESOLVE(napi_get_null)
  RESOLVE(napi_get_undefined)
  RESOLVE(napi_create_array)
  RESOLVE(napi_set_element)
  RESOLVE(napi_get_element)
  RESOLVE(napi_get_array_length)
  RESOLVE(napi_typeof)
  RESOLVE(napi_create_external)
  RESOLVE(napi_get_value_external)
#undef RESOLVE
  return true;
}

typedef struct {
  sqlite3 *db;
  bool closed;
} SotaDb;

typedef struct {
  sqlite3_stmt *stmt;
} SotaStmt;

static void DbFinalize(napi_env env, void *data, void *hint) {
  (void)env; (void)hint;
  SotaDb *d = data;
  if (d && !d->closed) sqlite3_close_v2(d->db);
  free(d);
}

static void StmtFinalize(napi_env env, void *data, void *hint) {
  (void)env; (void)hint;
  SotaStmt *s = data;
  if (s) sqlite3_finalize(s->stmt);
  free(s);
}

static void ThrowSqlite(napi_env env, sqlite3 *db, const char *what) {
  char msg[256];
  snprintf(msg, sizeof msg, "sota-sqlite: %s: %s", what,
           db ? sqlite3_errmsg(db) : "no db handle");
  p_napi_throw_error(env, NULL, msg);
}

// JS 参数数组 → sqlite 绑定。返回 false 时已抛错。
static bool BindParams(napi_env env, sqlite3_stmt *stmt, sqlite3 *db, napi_value params) {
  uint32_t n = 0;
  p_napi_get_array_length(env, params, &n);
  for (uint32_t i = 0; i < n; i++) {
    napi_value v;
    p_napi_get_element(env, params, i, &v);
    napi_valuetype t;
    p_napi_typeof(env, v, &t);
    int rc;
    if (t == napi_null) {
      rc = sqlite3_bind_null(stmt, (int)i + 1);
    } else if (t == napi_number) {
      double d;
      p_napi_get_value_double(env, v, &d);
      if (d == floor(d) && d >= -9007199254740992.0 && d <= 9007199254740992.0)
        rc = sqlite3_bind_int64(stmt, (int)i + 1, (sqlite3_int64)d);
      else
        rc = sqlite3_bind_double(stmt, (int)i + 1, d);
    } else if (t == napi_string) {
      size_t len = 0;
      p_napi_get_value_string_utf8(env, v, NULL, 0, &len);
      char *buf = malloc(len + 1);
      if (!buf) { p_napi_throw_error(env, NULL, "sota-sqlite: oom"); return false; }
      p_napi_get_value_string_utf8(env, v, buf, len + 1, &len);
      rc = sqlite3_bind_text(stmt, (int)i + 1, buf, (int)len, SQLITE_TRANSIENT);
      free(buf);
    } else {
      char msg[64];
      snprintf(msg, sizeof msg, "sota-sqlite: unsupported param type at index %u", i);
      p_napi_throw_error(env, NULL, msg);
      return false;
    }
    if (rc != SQLITE_OK) { ThrowSqlite(env, db, "bind"); return false; }
  }
  return true;
}

// 当前行 → JS 对象。返回 false 时已抛错。
static bool RowToObject(napi_env env, sqlite3_stmt *stmt, napi_value *out) {
  int cols = sqlite3_column_count(stmt);
  p_napi_create_object(env, out);
  for (int c = 0; c < cols; c++) {
    const char *name = sqlite3_column_name(stmt, c);
    napi_value v;
    switch (sqlite3_column_type(stmt, c)) {
      case SQLITE_INTEGER: {
        // JS number 上限 2^53;文件索引值域(id/mtime/size/count)在其内
        sqlite3_int64 i64 = sqlite3_column_int64(stmt, c);
        p_napi_create_double(env, (double)i64, &v);
        break;
      }
      case SQLITE_FLOAT:
        p_napi_create_double(env, sqlite3_column_double(stmt, c), &v);
        break;
      case SQLITE_TEXT: {
        const unsigned char *txt = sqlite3_column_text(stmt, c);
        int bytes = sqlite3_column_bytes(stmt, c);
        p_napi_create_string_utf8(env, txt ? (const char *)txt : "", bytes, &v);
        break;
      }
      case SQLITE_NULL:
        p_napi_get_null(env, &v);
        break;
      default:
        p_napi_throw_error(env, NULL, "sota-sqlite: unsupported column type (blob)");
        return false;
    }
    p_napi_set_named_property(env, *out, name, v);
  }
  return true;
}

// reset→clear→bind;失败已抛错返回 false
static bool ResetAndBind(napi_env env, SotaStmt *s, napi_value params) {
  sqlite3_reset(s->stmt);
  sqlite3_clear_bindings(s->stmt);
  return BindParams(env, s->stmt, sqlite3_db_handle(s->stmt), params);
}

static napi_value Open(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  p_napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 1) { p_napi_throw_error(env, NULL, "sota-sqlite: open needs a path"); return NULL; }
  char path[1024];
  size_t len = 0;
  p_napi_get_value_string_utf8(env, argv[0], NULL, 0, &len);
  if (len >= sizeof path) { p_napi_throw_error(env, NULL, "sota-sqlite: path too long"); return NULL; }
  p_napi_get_value_string_utf8(env, argv[0], path, sizeof path, &len);

  SotaDb *d = calloc(1, sizeof(SotaDb));
  if (!d) { p_napi_throw_error(env, NULL, "sota-sqlite: oom"); return NULL; }
  int rc = sqlite3_open_v2(path, &d->db,
                           SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX,
                           NULL);
  if (rc != SQLITE_OK) {
    ThrowSqlite(env, d->db, "open");
    sqlite3_close_v2(d->db);
    free(d);
    return NULL;
  }
  napi_value ext;
  if (p_napi_create_external(env, d, DbFinalize, NULL, &ext) != napi_ok) {
    sqlite3_close_v2(d->db);
    free(d);
    return NULL;
  }
  return ext;
}

static napi_value Close(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  p_napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 1) return NULL;
  SotaDb *d = NULL;
  if (p_napi_get_value_external(env, argv[0], (void **)&d) != napi_ok || !d) return NULL;
  if (!d->closed) {
    sqlite3_close_v2(d->db);
    d->closed = true;
  }
  napi_value undef;
  p_napi_get_undefined(env, &undef);
  return undef;
}

static napi_value Exec(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  p_napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 2) { p_napi_throw_error(env, NULL, "sota-sqlite: exec needs (db, sql)"); return NULL; }
  SotaDb *d = NULL;
  if (p_napi_get_value_external(env, argv[0], (void **)&d) != napi_ok || !d || d->closed) {
    p_napi_throw_error(env, NULL, "sota-sqlite: db is closed");
    return NULL;
  }
  char sql[8192];
  size_t len = 0;
  p_napi_get_value_string_utf8(env, argv[1], NULL, 0, &len);
  if (len >= sizeof sql) { p_napi_throw_error(env, NULL, "sota-sqlite: sql too long for exec buffer"); return NULL; }
  p_napi_get_value_string_utf8(env, argv[1], sql, sizeof sql, &len);

  char *err = NULL;
  if (sqlite3_exec(d->db, sql, NULL, NULL, &err) != SQLITE_OK) {
    ThrowSqlite(env, d->db, "exec");
    sqlite3_free(err);
    return NULL;
  }
  sqlite3_free(err);
  napi_value undef;
  p_napi_get_undefined(env, &undef);
  return undef;
}

static napi_value Prepare(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  p_napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 2) { p_napi_throw_error(env, NULL, "sota-sqlite: prepare needs (db, sql)"); return NULL; }
  SotaDb *d = NULL;
  if (p_napi_get_value_external(env, argv[0], (void **)&d) != napi_ok || !d || d->closed) {
    p_napi_throw_error(env, NULL, "sota-sqlite: db is closed");
    return NULL;
  }
  char sql[8192];
  size_t len = 0;
  p_napi_get_value_string_utf8(env, argv[1], NULL, 0, &len);
  if (len >= sizeof sql) { p_napi_throw_error(env, NULL, "sota-sqlite: sql too long for prepare buffer"); return NULL; }
  p_napi_get_value_string_utf8(env, argv[1], sql, sizeof sql, &len);

  sqlite3_stmt *raw = NULL;
  if (sqlite3_prepare_v2(d->db, sql, (int)len, &raw, NULL) != SQLITE_OK || !raw) {
    ThrowSqlite(env, d->db, "prepare");
    sqlite3_finalize(raw);
    return NULL;
  }
  SotaStmt *s = calloc(1, sizeof(SotaStmt));
  if (!s) { sqlite3_finalize(raw); p_napi_throw_error(env, NULL, "sota-sqlite: oom"); return NULL; }
  s->stmt = raw;
  napi_value ext;
  if (p_napi_create_external(env, s, StmtFinalize, NULL, &ext) != napi_ok) {
    sqlite3_finalize(raw);
    free(s);
    return NULL;
  }
  return ext;
}

static napi_value StmtGet(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  p_napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 2) { p_napi_throw_error(env, NULL, "sota-sqlite: get needs (stmt, params)"); return NULL; }
  SotaStmt *s = NULL;
  if (p_napi_get_value_external(env, argv[0], (void **)&s) != napi_ok || !s) {
    p_napi_throw_error(env, NULL, "sota-sqlite: bad stmt");
    return NULL;
  }
  if (!ResetAndBind(env, s, argv[1])) return NULL;
  int rc = sqlite3_step(s->stmt);
  if (rc == SQLITE_DONE) {
    napi_value undef;
    p_napi_get_undefined(env, &undef);
    return undef;
  }
  if (rc != SQLITE_ROW) { ThrowSqlite(env, sqlite3_db_handle(s->stmt), "step"); return NULL; }
  napi_value row;
  if (!RowToObject(env, s->stmt, &row)) return NULL;
  return row;
}

static napi_value StmtAll(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  p_napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 2) { p_napi_throw_error(env, NULL, "sota-sqlite: all needs (stmt, params)"); return NULL; }
  SotaStmt *s = NULL;
  if (p_napi_get_value_external(env, argv[0], (void **)&s) != napi_ok || !s) {
    p_napi_throw_error(env, NULL, "sota-sqlite: bad stmt");
    return NULL;
  }
  if (!ResetAndBind(env, s, argv[1])) return NULL;
  napi_value rows, row;
  p_napi_create_array(env, &rows);
  uint32_t n = 0;
  for (;;) {
    int rc = sqlite3_step(s->stmt);
    if (rc == SQLITE_DONE) break;
    if (rc != SQLITE_ROW) { ThrowSqlite(env, sqlite3_db_handle(s->stmt), "step"); return NULL; }
    if (!RowToObject(env, s->stmt, &row)) return NULL;
    p_napi_set_element(env, rows, n++, row);
  }
  return rows;
}

static napi_value StmtRun(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  p_napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 2) { p_napi_throw_error(env, NULL, "sota-sqlite: run needs (stmt, params)"); return NULL; }
  SotaStmt *s = NULL;
  if (p_napi_get_value_external(env, argv[0], (void **)&s) != napi_ok || !s) {
    p_napi_throw_error(env, NULL, "sota-sqlite: bad stmt");
    return NULL;
  }
  sqlite3 *db = sqlite3_db_handle(s->stmt);
  if (!ResetAndBind(env, s, argv[1])) return NULL;
  int rc = sqlite3_step(s->stmt);
  if (rc != SQLITE_DONE && rc != SQLITE_ROW) { ThrowSqlite(env, db, "step"); return NULL; }
  napi_value out, v;
  p_napi_create_object(env, &out);
  p_napi_create_double(env, (double)sqlite3_changes(db), &v);
  p_napi_set_named_property(env, out, "changes", v);
  p_napi_create_double(env, (double)sqlite3_last_insert_rowid(db), &v);
  p_napi_set_named_property(env, out, "lastInsertRowid", v);
  return out;
}

static napi_value Init(napi_env env, napi_value exports) {
  if (!resolve_napi()) return exports; // shim 日志可见空 exports,足以定位
  napi_value fn;
#define EXPORT(name, impl)                                                     \
  p_napi_create_function(env, name, NAPI_AUTO_LENGTH, impl, NULL, &fn);        \
  p_napi_set_named_property(env, exports, name, fn);
  EXPORT("open", Open)
  EXPORT("close", Close)
  EXPORT("exec", Exec)
  EXPORT("prepare", Prepare)
  EXPORT("stmtGet", StmtGet)
  EXPORT("stmtAll", StmtAll)
  EXPORT("stmtRun", StmtRun)
#undef EXPORT
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
