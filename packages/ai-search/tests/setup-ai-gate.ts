import { vi } from 'vitest'

// The ai-gate master switch ships as `true` (store-review build) and makes
// the search transports refuse outright. This suite describes the AI-enabled
// search behavior, so lift the gate for the whole suite (see ai-gate).
vi.mock('@genoffice/electron-utils/ai-gate', () => ({ AI_DISABLED: false }))
