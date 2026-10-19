#!/bin/bash
# NAPI 探针交叉编译(纯 C,验证 fork 的 napi 子集;一次性工具,真机验证后可删)
#
# 正确命令:bash apps/shell/vendor/sqlite/build-probe.sh
# 产物:    apps/shell/vendor/sqlite/libsqlite_probe.node
#           (装机:cp 到壳仓 entry/libs/arm64-v8a/,collectAllLibs 自动进 HAP;
#            shim 临时桩负责 dlopen + 调用,结果落 shim-log.txt)
set -eo pipefail

cd "$(dirname "$0")"
NDKBIN=${OHOS_NDK_BIN:-/apps/harmony/sdk/default/openharmony/native/llvm/bin}
CC="$NDKBIN/aarch64-unknown-linux-ohos-clang"
READELF="$NDKBIN/llvm-readelf"

GENOFFICE_ROOT="$(git rev-parse --show-toplevel)"
ENGINE_LIBS="$GENOFFICE_ROOT/../../web_engine/libs/arm64-v8a"
[ -f "$ENGINE_LIBS/libelectron.so" ] || { echo "FATAL: 找不到 libelectron.so" >&2; exit 1; }
# 探针 include:launcher 内嵌 napi 头 + fork 源目录(node_api.h 会 include node_version.h)
INC="$GENOFFICE_ROOT/apps/sheets/native/xlsx-launcher/include"
[ -f "$INC/node_api.h" ] || { echo "FATAL: 缺 napi 头" >&2; exit 1; }
ELECTRON_NODE_SRC="$GENOFFICE_ROOT/../../thirdparty/electron/src/third_party/electron_node/src"
[ -f "$ELECTRON_NODE_SRC/node_version.h" ] || {
  echo "FATAL: 缺 node_version.h(thirdparty/electron submodule 未初始化?)" >&2; exit 1;
}

# 技巧同 xlsx-launcher:显式 DT_NEEDED libelectron.so 防 napi_* 被劫持;.node 后缀
$CC -shared -fPIC -O2 -Wall -I"$INC" -DNODE_GYP_MODULE_NAME=sqlite_probe \
  -L"$ENGINE_LIBS" -Wl,--no-as-needed -lelectron \
  -I"$ELECTRON_NODE_SRC" -o libsqlite_probe.node probe.c

[ -s libsqlite_probe.node ] || { echo "FATAL: 产物缺失" >&2; exit 1; }
$READELF -d libsqlite_probe.node | grep -q libelectron.so \
  || { echo "FATAL: 缺 DT_NEEDED libelectron.so" >&2; exit 1; }
echo "==> $PWD/libsqlite_probe.node ($(stat -c%s libsqlite_probe.node) bytes)"
