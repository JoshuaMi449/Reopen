import { closeSync, fstatSync, mkdirSync, openSync, readSync } from 'fs'
import { join } from 'path'
import { StringDecoder } from 'string_decoder'

/** Children inherit regular files, never a pipe whose reader dies with Reopen. */
export function createProcessLogs(directory: string, onData: (text: string, stream: string) => void): {
  stdio: ['ignore', number, number]
  flush: () => void
  close: () => void
} {
  mkdirSync(directory, { recursive: true })
  const streams = ['stdout', 'stderr'].map((name) => {
    const fd = openSync(join(directory, `${name}.log`), 'a+')
    return { name, fd, offset: fstatSync(fd).size, decoder: new StringDecoder('utf8') }
  })
  let closed = false
  const flush = (): void => {
    if (closed) return
    for (const stream of streams) {
      // Bound work per tick when a misbehaving service logs continuously.
      const length = Math.min(65536, Math.max(0, fstatSync(stream.fd).size - stream.offset))
      if (!length) continue
      const buffer = Buffer.allocUnsafe(length)
      const read = readSync(stream.fd, buffer, 0, length, stream.offset)
      stream.offset += read
      const text = stream.decoder.write(buffer.subarray(0, read))
      if (text) onData(text, stream.name)
    }
  }
  const timer = setInterval(flush, 150)
  timer.unref()
  return {
    stdio: ['ignore', streams[0].fd, streams[1].fd],
    flush,
    close: () => {
      if (closed) return
      flush()
      closed = true
      clearInterval(timer)
      for (const stream of streams) {
        const tail = stream.decoder.end()
        if (tail) onData(tail, stream.name)
        closeSync(stream.fd)
      }
    }
  }
}
