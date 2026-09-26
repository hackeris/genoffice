// xlsx 启动壳(napi addon,打包态专用):
// 用系统 Native 子进程机制拉起表格引擎,替代 fork+exec——
// 这样 HAP 无需 executableBinaryPaths 声明,平板(tablet)才能安装。
//
// 导出:
//   startChild(entry) -> 父端 fd   创建子进程(entry 形如 "libxlsx_sidecar.so:Main"),
//                                  socketpair 一端随 args 传给子进程,返回父端 fd
//   lastChildPid()    -> pid       最近一次创建的子进程 pid
//
// 关键工程决策(尖兵实测结论,勿改回):
//   1. napi 函数一律运行时 dlsym 自 libelectron.so,不产生静态 UND 引用——
//      鸿蒙应用命名空间里 libace_napi.z.so 导出同名 napi_*,静态绑定会劫持到错误实现
//   2. 进程名保持 "pipe" 与 Rust 侧 ohos_child_entry.rs 的约定一致
//   3. 子进程生命周期与连接绑定:父端销毁 → 子进程 stdin EOF → Main 返回 → 退出
#include <stdbool.h>
#include <node_api.h>
#include <AbilityKit/native_child_process.h>
#include <sys/socket.h>
#include <unistd.h>
#include <dlfcn.h>
#include <stdio.h>

static int32_t g_last_pid = -1;

static __typeof__(napi_create_function) *p_napi_create_function;
static __typeof__(napi_set_named_property) *p_napi_set_named_property;
static __typeof__(napi_get_cb_info) *p_napi_get_cb_info;
static __typeof__(napi_create_int32) *p_napi_create_int32;
static __typeof__(napi_throw_error) *p_napi_throw_error;
static __typeof__(napi_get_value_string_utf8) *p_napi_get_value_string_utf8;

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
    RESOLVE(napi_create_int32)
    RESOLVE(napi_throw_error)
    RESOLVE(napi_get_value_string_utf8)
#undef RESOLVE
    return true;
}

static napi_value StartChild(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    p_napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

    char entry[160] = "libxlsx_sidecar.so:Main";
    if (argc >= 1) {
        size_t n = 0;
        p_napi_get_value_string_utf8(env, argv[0], entry, sizeof entry, &n);
    }

    int sv[2];
    if (socketpair(AF_UNIX, SOCK_STREAM, 0, sv) != 0) {
        p_napi_throw_error(env, NULL, "xlsx launcher: socketpair failed");
        return NULL;
    }

    NativeChildProcess_Fd fdrec = { .fdName = "pipe", .fd = sv[1], .next = NULL };
    NativeChildProcess_Args args = { .entryParams = NULL, .fdList = { .head = &fdrec } };
    NativeChildProcess_Options opts = { .isolationMode = NCP_ISOLATION_MODE_NORMAL, .reserved = 0 };

    int32_t pid = -1;
    Ability_NativeChildProcess_ErrCode rc =
        OH_Ability_StartNativeChildProcess(entry, args, opts, &pid);
    if (rc != NCP_NO_ERROR) {
        close(sv[0]);
        close(sv[1]);
        char msg[96];
        snprintf(msg, sizeof msg, "xlsx launcher: StartNativeChildProcess rc=%d", (int)rc);
        p_napi_throw_error(env, NULL, msg);
        return NULL;
    }
    close(sv[1]); // 父进程不再持有子端
    g_last_pid = pid;

    napi_value out;
    p_napi_create_int32(env, sv[0], &out);
    return out;
}

static napi_value LastChildPid(napi_env env, napi_callback_info info) {
    (void)info;
    napi_value out;
    p_napi_create_int32(env, g_last_pid, &out);
    return out;
}

static napi_value Init(napi_env env, napi_value exports) {
    if (!resolve_napi()) {
        // 此刻 p_napi_throw_error 可能尚未解析出(resolve 在首个缺失符号处即返回),
        // 对它取值是空指针调用;降级为 stderr 提示并返回空 exports——shim 侧对
        // 导出函数有 typeof 检查,会走 spawn 回退并在首个请求时报出明确错误
        fprintf(stderr, "xlsx launcher: napi symbols not resolved from libelectron\n");
        return exports;
    }
    napi_value fn;
    if (p_napi_create_function(env, "startChild", NAPI_AUTO_LENGTH, StartChild, NULL, &fn) == napi_ok)
        p_napi_set_named_property(env, exports, "startChild", fn);
    if (p_napi_create_function(env, "lastChildPid", NAPI_AUTO_LENGTH, LastChildPid, NULL, &fn) == napi_ok)
        p_napi_set_named_property(env, exports, "lastChildPid", fn);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
