//! 鸿蒙 Native 子进程入口(target_env = "ohos" 才编入)。
//!
//! 系统流程(官方 native_child_process.h 约定):主进程调
//! `OH_Ability_StartNativeChildProcess("libxlsx_sidecar.so:Main", args, ...)`,
//! appspawn fork 子进程后 dlopen 本库、`dlsym("Main")` 并以 `NativeChildProcess_Args`
//! 按值调用;Main 返回子进程即退出。
//!
//! 我们从 args.fdList 取出名为 "pipe" 的 fd(主进程 socketpair 的一端),
//! dup2 成 stdin/stdout,然后进入与独立程序完全相同的协议主循环。
//! 父进程关流 → stdin EOF → 循环结束 → Main 返回 → 子进程退出,
//! 与可执行文件时代「父死子亡」的生命周期语义一致。

use std::ffi::CStr;

/// 系统 ABI:native_child_process.h 的 NativeChildProcess_Fd
#[repr(C)]
struct NativeChildProcessFd {
    fd_name: *const std::os::raw::c_char,
    fd: i32,
    next: *mut NativeChildProcessFd,
}

/// 系统 ABI:NativeChildProcess_FdList
#[repr(C)]
struct NativeChildProcessFdList {
    head: *mut NativeChildProcessFd,
}

/// 系统 ABI:NativeChildProcess_Args(按值传入,布局须与头文件一致)
#[repr(C)]
struct NativeChildProcessArgs {
    entry_params: *const std::os::raw::c_char,
    fd_list: NativeChildProcessFdList,
}

unsafe extern "C" {
    fn dup2(oldfd: i32, newfd: i32) -> i32;
    fn close(fd: i32) -> i32;
}

const IO_FD_NAME: &CStr = c"pipe";
const STDIN_FD: i32 = 0;
const STDOUT_FD: i32 = 1;

/// 系统约定的子进程入口(函数名必须是 "Main")。
#[unsafe(no_mangle)]
pub extern "C" fn Main(args: NativeChildProcessArgs) {
    let mut io_fd: i32 = -1;
    let mut cursor = args.fd_list.head;
    while !cursor.is_null() {
        // SAFETY: 链表由系统在 fork 前组装,本次调用期内有效
        let node = unsafe { &*cursor };
        if !node.fd_name.is_null() {
            // SAFETY: fdName 是系统写入的 NUL 结尾 C 字符串
            let name = unsafe { CStr::from_ptr(node.fd_name) };
            if name == IO_FD_NAME {
                io_fd = node.fd;
                break;
            }
        }
        cursor = node.next;
    }
    if io_fd < 0 {
        // 没拿到约定的 fd:无事可做,立即退出让主进程侧看到连接关闭
        return;
    }
    // SAFETY: io_fd 是系统传来的合法描述符;dup 到 0/1 后按 stdio 使用。
    // 任一 dup2 失败说明 stdio 没接上:立即返回让父端看到连接关闭——绝不能
    // 带着未接好的流继续跑(表现为每个请求 30s 超时且零诊断)。
    unsafe {
        if dup2(io_fd, STDIN_FD) == -1 || dup2(io_fd, STDOUT_FD) == -1 {
            return;
        }
        // 系统若恰好把 fd 编号传成 0/1,dup2 是 no-op,close 会关死刚装好的流
        if io_fd != STDIN_FD && io_fd != STDOUT_FD {
            close(io_fd);
        }
    }
    crate::protocol::run_stdio_main();
}
