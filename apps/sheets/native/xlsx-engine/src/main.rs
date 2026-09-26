// 独立程序入口(开发机直接跑):协议实现已上移 protocol.rs,与鸿蒙
// Native 子进程入口(ohos_child_entry.rs)共用同一份主循环。
fn main() {
    xlsx_sidecar::protocol::run_stdio_main()
}
