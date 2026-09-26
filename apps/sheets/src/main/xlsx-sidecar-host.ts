//! xlsx sidecar 宿主衔接:把子进程通道适配成上游 XlsxSidecarClient 期望的
//! ChildProcessWithoutNullStreams 形状,客户端文件除取进程的一行外与上游逐字一致。
//!
//! 为什么需要:鸿蒙统一包不能声明 executableBinaryPaths(只在 2in1 生效,pad
//! 见之拒装),spawn 不可用;改走系统 Native 子进程(OH_Ability_StartNativeChildProcess)
//! ——系统 fork 后 dlopen libxlsx_sidecar.so,父进程拿到 socketpair 的裸 fd。
//! 开发机无启动壳,回退上游原有 spawn 路径,两端共享同一份客户端代码。
//!
//! 成员映射(上游对 child 的全部访问,清单外不实现):
//!   stdin.write(payload, cb)    → socket.write(ensureFramed(payload), cb)
//!   stdout(createInterface 入参) → 同一 socket(双向,读写互不干扰)
//!   stderr.setEncoding/on        → 哑桩(Native 子进程没有诊断流,永不 emit)
//!   pid / killed                 → lastChildPid() / socket.destroyed
//!   kill()                       → socket.destroy()(父端断开 → 子进程读 EOF 退出)
//!   once('error')                → socket 'error'
//!   once('exit', code, signal)   → socket 'close'(code/signal 传 null)

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { closeSync } from 'node:fs'
import { Socket } from 'node:net'

/** shim preload 注入的原生启动壳(libxlsx_launcher.node)。 */
interface XlsxLauncher {
  startChild(entry: string): number
  lastChildPid(): number
}

const getLauncher = (): XlsxLauncher | null => {
  const holder = globalThis as { __sotaXlsxLauncher?: Partial<XlsxLauncher> }
  const launcher = holder.__sotaXlsxLauncher
  return typeof launcher?.startChild === 'function' ? (launcher as XlsxLauncher) : null
}

/** Native 子进程入口:系统 dlopen libxlsx_sidecar.so 后调用其 Main。 */
const SIDECAR_NATIVE_ENTRY = 'libxlsx_sidecar.so:Main'

/** 帧兜底:JSON-lines 靠 \n 断帧。上游写入点均自带换行,此处再兜一层——
 * 漏拼换行会让引擎 read_line 永久阻塞、每个请求 30s 超时。 */
const ensureFramed = (payload: string): string => (payload.endsWith('\n') ? payload : `${payload}\n`)

/** 打包态:socketpair fd → 上游 ChildProcess 形状。 */
function launcherChild(launcher: XlsxLauncher): ChildProcessWithoutNullStreams {
  const fd = launcher.startChild(SIDECAR_NATIVE_ENTRY)
  let socket: Socket
  try {
    socket = new Socket({ fd, readable: true, writable: true })
  } catch (error) {
    // 子进程已真实创建:关掉父端让它读到 EOF 退出,不能留下孤儿进程与泄漏的 fd
    try {
      closeSync(fd)
    } catch {
      /* fd 已失效 */
    }
    throw error
  }
  const pid = launcher.lastChildPid()

  // 上游对 stderr 只调 setEncoding 与 on('data');哑桩让两者成为无害空操作
  const stderrStub = {
    setEncoding: (): void => {},
    on: (): void => {},
  }

  const child = {
    stdin: {
      write: (payload: string, cb?: (error?: Error | null) => void): boolean =>
        socket.write(ensureFramed(payload), cb),
    },
    stdout: socket,
    stderr: stderrStub,
    pid,
    get killed(): boolean {
      return socket.destroyed
    },
    kill: (): boolean => {
      socket.destroy()
      return true
    },
    once: (event: string, listener: (...args: never[]) => void): void => {
      if (event === 'error') {
        socket.once('error', listener as (error: Error) => void)
        return
      }
      if (event === 'exit') {
        socket.once('close', () => (listener as (code: null, signal: null) => void)(null, null))
        return
      }
      // 上游只注册 error/exit(成员审计清单见文件头);清单外事件必须响亮失败
      // 而不是静默吞掉——throw 沿 IPC 拒绝路径走,表现为带文案的错误提示
      throw new Error(`xlsx-sidecar-host: 子进程不支持事件 ${event}(成员清单需更新)`)
    },
  }
  // 形状由上方逐成员保证,此处收口为上游契约
  return child as unknown as ChildProcessWithoutNullStreams
}

/** 客户端取子进程的唯一入口:有启动壳走 Native 子进程,没有回退 spawn。 */
export function resolveChildProcess(binaryPath: string): ChildProcessWithoutNullStreams {
  const launcher = getLauncher()
  if (launcher) return launcherChild(launcher)
  return spawn(binaryPath, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}
