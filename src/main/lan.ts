// 局域网工具：本机 IP 探测（从 ipc 迁入，避免 projectManager 反向依赖 ipc 成环）
import { networkInterfaces } from 'os'
import { connect } from 'net'

/** 本机局域网 IPv4（第一个非内环地址；没有返回 ''） */
export function getLanIp(): string {
  const list = networkInterfaces()
  for (const name of Object.keys(list)) {
    for (const info of list[name] ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address
    }
  }
  return ''
}

/** 探测 lanIp:port 能否 TCP 连上（服务只绑 127.0.0.1 → 局域网连不上 → false）。
 *  单发探测：lan 地址就是具体 IPv4，无需双栈 */
export function probeLan(ip: string, port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const sock = connect({ host: ip, port })
    sock.setTimeout(800)
    sock.on('connect', () => {
      sock.destroy()
      resolvePromise(true)
    })
    sock.on('timeout', () => {
      sock.destroy()
      resolvePromise(false)
    })
    sock.on('error', () => resolvePromise(false))
  })
}
