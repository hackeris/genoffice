#!/bin/bash
# xlsx 启动壳(napi addon)交叉编译:aarch64-ohos 的 .node 进 HAP libs
#
# 正确命令:bash apps/sheets/native/xlsx-launcher/build.sh   (genoffice 仓根或任意 cwd 可跑)
# 产物:    entry/libs/arm64-v8a/libxlsx_launcher.node(shim 预加载后经
#          globalThis.__sotaXlsxLauncher 供 sheets 客户端使用)
# 前提:    /apps/harmony(command-line-tools);include/ 已内嵌 node 22.17 napi 头
#          (带 LICENSE.node,升级 Node 时同步更新)
# 踩坑:    ① fork 的 dlopen 只认 .node 后缀(否则静默失败)——产物必须 .node 命名
#          ② 必须显式 DT_NEEDED libelectron.so,否则 napi_* 会被应用命名空间里
#             同名的 libace_napi.z.so 劫持;且源码层用 dlsym 运行时解析,双保险
set -eo pipefail

cd "$(dirname "$0")"
NDKBIN=/apps/harmony/sdk/default/openharmony/native/llvm/bin
CC="$NDKBIN/aarch64-unknown-linux-ohos-clang"
GENOFFICE_ROOT="$(git rev-parse --show-toplevel)"
ENGINE_LIBS="$GENOFFICE_ROOT/../../web_engine/libs/arm64-v8a"
# web_engine 在壳仓,HAP 装载的 libelectron.so 与链接期这份是同一产物
if [ ! -f "$ENGINE_LIBS/libelectron.so" ]; then
  ENGINE_LIBS="/data/share/smartoffice/web_engine/libs/arm64-v8a"
fi
[ -f "$ENGINE_LIBS/libelectron.so" ] || { echo "FATAL: 找不到 libelectron.so(链接锚点)" >&2; exit 1; }
NODE_INC="$PWD/include"

"$CC" -shared -fPIC -O2 -Wall -I"$NODE_INC" -DNODE_GYP_MODULE_NAME=xlsx_launcher \
  -L"$ENGINE_LIBS" -Wl,--no-as-needed -lelectron \
  -o libxlsx_launcher.so xlsx_launcher.c -lchild_process

# 库的壳仓布局:genoffice 是 submodule,壳仓根 = genoffice/../..
DST="$GENOFFICE_ROOT/../../entry/libs/arm64-v8a"
if [ ! -d "$DST" ]; then
  echo "FATAL: 壳仓 libs 目录不存在: $DST" >&2
  exit 1
fi
cp -f libxlsx_launcher.so "$DST/libxlsx_launcher.node"
echo "==> $DST/libxlsx_launcher.node"
