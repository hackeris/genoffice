import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stampAiGeneratedPng } from '@genoffice/electron-utils/image-aigc'

/** The renderer's provenance latch, held per export session */
export interface ExportSessionAigc {
  provider: string
  produceId: string
}

/** Only dialog-approved folders are registered; renderers never supply output paths. */
export class ImageExportSessions {
  private sessions = new Map<
    string,
    { owner: number; dir: string; pages: number; aigc: ExportSessionAigc | null }
  >()

  async start(
    owner: number,
    parent: string,
    name: string,
    aigc?: ExportSessionAigc,
  ): Promise<string> {
    const base =
      name
        .replace(/[/\\:*?"<>|]/g, '_')
        .slice(0, 80)
        .trim() || 'Untitled'
    const dir = await mkdtemp(join(parent, `${base}-images-`))
    const id = randomUUID()
    this.sessions.set(id, { owner, dir, pages: 0, aigc: aigc ?? null })
    return id
  }

  private get(owner: number, id: string) {
    const session = this.sessions.get(id)
    if (!session || session.owner !== owner) throw new Error('Export session is not authorized')
    return session
  }

  async write(owner: number, id: string, page: number, base64: string): Promise<void> {
    const session = this.get(owner, id)
    if (!Number.isSafeInteger(page) || page !== session.pages + 1)
      throw new Error('Invalid export page number')
    if (typeof base64 !== 'string') throw new Error('Invalid PNG data')
    const bytes = Buffer.from(base64, 'base64')
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      throw new Error('Invalid PNG data')
    // rasterized pages of an AI-mutated document carry the TC260 marking
    // even though the temp PDF they came from is discarded
    const stamped = session.aigc
      ? Buffer.from(stampAiGeneratedPng(new Uint8Array(bytes), session.aigc))
      : bytes
    await writeFile(join(session.dir, `page-${String(page).padStart(2, '0')}.png`), stamped, {
      flag: 'wx',
    })
    session.pages = page
  }

  async finish(owner: number, id: string, success: boolean): Promise<string | null> {
    const session = this.get(owner, id)
    this.sessions.delete(id)
    if (!success || !session.pages) {
      await rm(session.dir, { recursive: true, force: true })
      if (success) throw new Error('Cannot complete an empty image export')
      return null
    }
    return session.dir
  }

  async dispose(owner: number): Promise<void> {
    await Promise.all(
      [...this.sessions.entries()]
        .filter(([, session]) => session.owner === owner)
        .map(([id]) => this.finish(owner, id, false)),
    )
  }
}
