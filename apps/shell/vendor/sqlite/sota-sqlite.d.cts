// sota-sqlite 类型存根:与 node:sqlite(@types/node)的对应子集形状一致——
// shell 里 `import type { DatabaseSync } from 'node:sqlite'` 仍是首要类型来源,
// 此文件只服务 tsconfig paths 对 "sota-sqlite" 的映射(require 断言目标)。
export class StatementSync {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number };
}
export class DatabaseSync {
  constructor(path: string);
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
  close(): void;
}
