// 纯 C NAPI 探针(dlsym 版):验证 fork 上 sqlite 绑定所需的 NAPI 子集是否安全。
//
// 背景:fork 引擎在 OHOS 上,应用进程恒载系统 libace_napi.z.so(同名 napi_* 符号;
// 见 fork 源 js_native_api.h 的 OSOHOS 段注释)——标准链接期重定位会把本 addon 的
// napi_* 调用 interpose 到 ace_napi,它收到 Node 的 env 即 abort("napi_env has
// been destroyed"),进程死(vscodium 记载的「ObjectWrap 构造即崩」疑为同根表象)。
// 解法 = xlsx-launcher 的实证配方:源码层 dlsym 从 libelectron.so 解析全部 napi_*,
// 不依赖链接期符号。本探针逐一验证 string/int64/null/object/array/external/
// reference 子集,结果落 shim 日志;真机验证后此桩与探针产物一并移除。
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <dlfcn.h>

#include <node_api.h>

static __typeof__(napi_create_function) *p_napi_create_function;
static __typeof__(napi_set_named_property) *p_napi_set_named_property;
static __typeof__(napi_get_named_property) *p_napi_get_named_property;
static __typeof__(napi_get_cb_info) *p_napi_get_cb_info;
static __typeof__(napi_throw_error) *p_napi_throw_error;
static __typeof__(napi_get_value_string_utf8) *p_napi_get_value_string_utf8;
static __typeof__(napi_create_string_utf8) *p_napi_create_string_utf8;
static __typeof__(napi_create_object) *p_napi_create_object;
static __typeof__(napi_create_double) *p_napi_create_double;
static __typeof__(napi_create_int64) *p_napi_create_int64;
static __typeof__(napi_get_null) *p_napi_get_null;
static __typeof__(napi_create_array) *p_napi_create_array;
static __typeof__(napi_set_element) *p_napi_set_element;
static __typeof__(napi_create_external) *p_napi_create_external;
static __typeof__(napi_get_value_external) *p_napi_get_value_external;
static __typeof__(napi_create_reference) *p_napi_create_reference;
static __typeof__(napi_delete_reference) *p_napi_delete_reference;
static __typeof__(napi_get_reference_value) *p_napi_get_reference_value;

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
  RESOLVE(napi_get_named_property)
  RESOLVE(napi_get_cb_info)
  RESOLVE(napi_throw_error)
  RESOLVE(napi_get_value_string_utf8)
  RESOLVE(napi_create_string_utf8)
  RESOLVE(napi_create_object)
  RESOLVE(napi_create_double)
  RESOLVE(napi_create_int64)
  RESOLVE(napi_get_null)
  RESOLVE(napi_create_array)
  RESOLVE(napi_set_element)
  RESOLVE(napi_create_external)
  RESOLVE(napi_get_value_external)
  RESOLVE(napi_create_reference)
  RESOLVE(napi_delete_reference)
  RESOLVE(napi_get_reference_value)
#undef RESOLVE
  return true;
}

// ---- echoRoundtrip(input: string) ----
static napi_value EchoRoundtrip(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  p_napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 1) { p_napi_throw_error(env, NULL, "probe: missing arg"); return NULL; }

  char buf[256];
  size_t len = 0;
  p_napi_get_value_string_utf8(env, argv[0], NULL, 0, &len);
  if (len >= sizeof(buf)) len = sizeof(buf) - 1;
  p_napi_get_value_string_utf8(env, argv[0], buf, sizeof(buf), &len);

  napi_value out, prop, arr;
  p_napi_create_object(env, &out);

  p_napi_create_string_utf8(env, buf, len, &prop);
  p_napi_set_named_property(env, out, "s", prop);

  p_napi_create_double(env, 123.5, &prop);
  p_napi_set_named_property(env, out, "n", prop);

  // int64 → JS number:文件索引的 id/rowid 走这条,验证往返
  p_napi_create_int64(env, (int64_t)4294967296LL + 7, &prop);
  p_napi_set_named_property(env, out, "i", prop);

  p_napi_get_null(env, &prop);
  p_napi_set_named_property(env, out, "z", prop);

  p_napi_create_array(env, &arr);
  for (uint32_t k = 0; k < 3; k++) {
    p_napi_create_double(env, (double)(k + 1), &prop);
    p_napi_set_element(env, arr, k, prop);
  }
  p_napi_set_named_property(env, out, "arr", arr);
  return out;
}

// ---- externalRoundtrip():create_external + finalize + get_value_external ----
static void FinalizeCb(napi_env env, void *data, void *hint) {
  (void)env; (void)hint;
  free(data);
}

static napi_value ExternalRoundtrip(napi_env env, napi_callback_info info) {
  (void)info;
  char *blob = malloc(16);
  if (!blob) { p_napi_throw_error(env, NULL, "probe: oom"); return NULL; }
  memset(blob, 0xAB, 16);

  napi_value ext;
  napi_status st = p_napi_create_external(env, blob, FinalizeCb, NULL, &ext);
  if (st != napi_ok) { p_napi_throw_error(env, NULL, "probe: create_external failed"); return NULL; }

  void *back = NULL;
  st = p_napi_get_value_external(env, ext, &back);
  if (st != napi_ok || back != blob) {
    p_napi_throw_error(env, NULL, "probe: external pointer mismatch");
    return NULL;
  }
  unsigned char first = ((const unsigned char *)back)[0];
  // finalize 触发时机由 GC 决定,这里只验证注册与指针往返
  napi_value out, prop;
  p_napi_create_object(env, &out);
  p_napi_create_int64(env, (int64_t)first, &prop);
  p_napi_set_named_property(env, out, "firstByte", prop);
  return out;
}

// ---- refRoundtrip(o: {tag}) :create_reference → get_reference 往返 ----
static napi_ref g_ref = NULL;

static napi_value RefRoundtrip(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  p_napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 1) { p_napi_throw_error(env, NULL, "probe: missing arg"); return NULL; }

  if (g_ref) { p_napi_delete_reference(env, g_ref); g_ref = NULL; }
  if (p_napi_create_reference(env, argv[0], 1, &g_ref) != napi_ok) {
    p_napi_throw_error(env, NULL, "probe: create_reference failed");
    return NULL;
  }
  napi_value back;
  if (p_napi_get_reference_value(env, g_ref, &back) != napi_ok || !back) {
    p_napi_throw_error(env, NULL, "probe: get_reference_value failed");
    return NULL;
  }
  napi_value tag;
  p_napi_get_named_property(env, back, "tag", &tag);
  return tag;
}

static napi_value Init(napi_env env, napi_value exports) {
  if (!resolve_napi()) return exports; // shim 日志会看到 exports 空,足以定位
  napi_value fn;
  p_napi_create_function(env, "echoRoundtrip", NAPI_AUTO_LENGTH, EchoRoundtrip, NULL, &fn);
  p_napi_set_named_property(env, exports, "echoRoundtrip", fn);
  p_napi_create_function(env, "externalRoundtrip", NAPI_AUTO_LENGTH, ExternalRoundtrip, NULL, &fn);
  p_napi_set_named_property(env, exports, "externalRoundtrip", fn);
  p_napi_create_function(env, "refRoundtrip", NAPI_AUTO_LENGTH, RefRoundtrip, NULL, &fn);
  p_napi_set_named_property(env, exports, "refRoundtrip", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
