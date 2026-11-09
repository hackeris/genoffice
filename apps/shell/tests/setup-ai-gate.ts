import { vi } from 'vitest'

// The ai-gate master switch ships as `true` (store-review build) and hides
// the AI settings sections from the modal. Tests here describe the settings
// surface with AI enabled, so lift the gate for the suite (see ai-gate).
vi.mock('@genoffice/electron-utils/ai-gate', () => ({ AI_DISABLED: false }))
