import { vi } from 'vitest'

// The ai-gate master switch ships as `true` (store-review build), and the
// fetch-layer guard throws before any wire call. This package's suite
// describes the AI-enabled wire behavior, so lift the gate for the whole
// suite instead of mocking per test file (see ai-gate).
vi.mock('@genoffice/electron-utils/ai-gate', () => ({ AI_DISABLED: false }))
