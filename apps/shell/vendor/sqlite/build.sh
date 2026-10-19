#!/bin/bash
# sota-sqlite(纯 C 绑定)→ aarch64-linux-ohos 交叉编译
#
# 正确命令:bash apps/shell/vendor/sqlite/build.sh   (genoffice 仓根或任意 cwd 可跑)
# 前提:    /apps/harmony NDK;
#          主仓 thirdparty/node-sqlite submodule(钉 v3.3.0,提供 sqlite3.c/.h);
#          web_engine/libs/arm64-v8a/libelectron.so(链接锚点,见下)
# 产物:    apps/shell/vendor/sqlite/libsota_sqlite.node
#          (build-genoffice.sh 拷进主仓 entry/libs/arm64-v8a/,shim 桩⑫ 预加载)
#
# 背景:鸿蒙 Electron fork(Node 22.17)未编入 node:sqlite,文件索引依赖它。
# C++ addon(node-addon-api/ObjectWrap)路线已被真机判死——OHOS 上 libace_napi.z.so
# 恒载同名 napi_* 符号,链接期重定位被 interpose 后 ace_napi 收到 Node env 即 abort
# (见 fork 源 js_native_api.h 的 OSOHOS 段、docs/appendix/C-hos-vscodium-runtime.md
# §7)。本绑定的生存配方 = xlsx-launcher/probe.c 实证:napi_* 全部 dlsym 自
# libelectron.so,sqlite3 amalgamation 直接编进本 addon(内部符号无劫持面)。
#
# ① 产物必须 .node 后缀——fork 的 dlopen 只认 .node(否则静默失败)
# ② dlsym 依赖 libelectron.so 已装载(NOLOAD 取句柄);shim 在主 bundle 前调用 ✓
# ③ C++ 运行时零依赖(纯 C),不引 libc++
# SQLITE_* defines 与 photostructure/node-sqlite 的 binding.gyp 对齐(FTS5 必需,
# 升级 submodule 时逐项核对)
set -eo pipefail

cd "$(dirname "$0")"

NDKBIN=${OHOS_NDK_BIN:-/apps/harmony/sdk/default/openharmony/native/llvm/bin}
CC="$NDKBIN/aarch64-unknown-linux-ohos-clang"
READELF="$NDKBIN/llvm-readelf"

GENOFFICE_ROOT="$(git rev-parse --show-toplevel)"
SRC_ROOT="$GENOFFICE_ROOT/../node-sqlite"
[ -f "$SRC_ROOT/src/upstream/sqlite3.c" ] || {
  echo "FATAL: 缺 $SRC_ROOT(主仓 thirdparty/node-sqlite submodule 未初始化?)" >&2
  exit 1
}
ENGINE_LIBS="$GENOFFICE_ROOT/../../web_engine/libs/arm64-v8a"
[ -f "$ENGINE_LIBS/libelectron.so" ] || { echo "FATAL: 找不到 libelectron.so(链接锚点)" >&2; exit 1; }
# napi 头:launcher 内嵌的 node 22.17 头;node_version.h 若上游 node_api.h 需要,
# 从 fork 源目录 -I 取,不落盘拷贝
INC="$GENOFFICE_ROOT/apps/sheets/native/xlsx-launcher/include"
[ -f "$INC/node_api.h" ] || { echo "FATAL: 缺 napi 头(xlsx-launcher/include)" >&2; exit 1; }
ELECTRON_NODE_SRC="$GENOFFICE_ROOT/../../thirdparty/electron/src/third_party/electron_node/src"
[ -f "$ELECTRON_NODE_SRC/node_version.h" ] || {
  echo "FATAL: 缺 $ELECTRON_NODE_SRC/node_version.h(thirdparty/electron submodule 未初始化?)" >&2
  exit 1
}

DEFS=(
  NAPI_VERSION=8
  HAVE_STDINT_H=1
  HAVE_USLEEP=1
  SQLITE_DEFAULT_FOREIGN_KEYS=1
  SQLITE_DEFAULT_MEMSTATUS=0
  SQLITE_DEFAULT_WAL_SYNCHRONOUS=1
  SQLITE_DQS=0
  SQLITE_ENABLE_API_ARMOR
  SQLITE_ENABLE_COLUMN_METADATA
  SQLITE_ENABLE_DBSTAT_VTAB
  SQLITE_ENABLE_FTS3_PARENTHESIS
  SQLITE_ENABLE_FTS3
  SQLITE_ENABLE_FTS4
  SQLITE_ENABLE_FTS5
  SQLITE_ENABLE_GEOPOLY
  SQLITE_ENABLE_JSON1
  SQLITE_ENABLE_MATH_FUNCTIONS
  SQLITE_ENABLE_NORMALIZE
  SQLITE_ENABLE_PERCENTILE
  SQLITE_ENABLE_PREUPDATE_HOOK
  SQLITE_ENABLE_RBU
  SQLITE_ENABLE_RTREE
  SQLITE_ENABLE_SESSION
  SQLITE_ENABLE_SNAPSHOT
  SQLITE_ENABLE_STAT4
  SQLITE_ENABLE_UPDATE_DELETE_LIMIT
  SQLITE_LIKE_DOESNT_MATCH_BLOBS
  SQLITE_OMIT_DEPRECATED
  SQLITE_OMIT_SHARED_CACHE
  SQLITE_SOUNDEX
  SQLITE_USE_URI=1
)

TMP=build-ohos-tmp
rm -rf "$TMP"
mkdir -p "$TMP"

echo "==> [1/2] 编 sqlite3.c amalgamation(约 1 分钟)…"
$CC -c "$SRC_ROOT/src/upstream/sqlite3.c" -o "$TMP/sqlite3.o" -O2 -fPIC -fvisibility=hidden \
  "${DEFS[@]/#/-D}" -I"$SRC_ROOT/src/upstream" 2> "$TMP/sqlite3.err" \
  || { tail -20 "$TMP/sqlite3.err" >&2; exit 1; }

echo "==> [2/2] 编 sota_sqlite.c 并链接 → libsota_sqlite.node"
# 技巧同 xlsx-launcher:.node 后缀(fork dlopen 硬要求);napi_* 全走 dlsym,
# 不依赖链接期解析,但仍显式 DT_NEEDED libelectron.so 保证句柄可取
$CC -shared -fPIC -O2 -Wall -I"$INC" -I"$SRC_ROOT/src/upstream" -I"$ELECTRON_NODE_SRC" \
  -DNODE_GYP_MODULE_NAME=sota_sqlite \
  "${DEFS[@]/#/-D}" \
  -L"$ENGINE_LIBS" -Wl,--no-as-needed -lelectron -lm \
  -o libsota_sqlite.node sota_sqlite.c "$TMP/sqlite3.o" \
  2> "$TMP/sota.err" || { tail -30 "$TMP/sota.err" >&2; exit 1; }
rm -rf "$TMP"

# 验收断言
[ -s libsota_sqlite.node ] || { echo "FATAL: 产物缺失" >&2; exit 1; }
ARCH=$($READELF -h libsota_sqlite.node | awk '/Machine:/{print $2}')
echo "$ARCH" | grep -q AArch64 || { echo "FATAL: 非 arm64 产物: $ARCH" >&2; exit 1; }
NEEDED=$($READELF -d libsota_sqlite.node | grep NEEDED || true)
echo "$NEEDED" | grep -q libelectron.so \
  || { echo "FATAL: 缺 DT_NEEDED libelectron.so" >&2; exit 1; }
UNDEF=$($NDKBIN/llvm-nm -u libsota_sqlite.node 2>/dev/null | grep -cE ' napi_' || true)
if [ "$UNDEF" != "0" ]; then
  # 链接期引用 napi_* 即劫持面(会被 libace_napi.z.so interpose → abort)
  $NDKBIN/llvm-nm -u libsota_sqlite.node | grep napi_ | head -5 >&2
  echo "FATAL: 存在链接期 napi_* 引用(必须全部 dlsym)" >&2
  exit 1
fi
echo "    架构: $ARCH"
echo "$NEEDED" | sed 's/^/    /'
echo "==> 完成: $PWD/libsota_sqlite.node ($(stat -c%s libsota_sqlite.node) bytes)"
