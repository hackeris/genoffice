/**
 * Master switch for AI features. true = every user-visible AI entry point is
 * hidden (store-review build): no AI panel / ribbon group / context-menu item /
 * selection popover / shortcut / settings section / help topic renders in any
 * app, native menus drop their AI items, and the ai-provider request entry
 * refuses outright (UI, CLI and MCP all funnel through that provider layer).
 *
 * Gates always wrap the original code (`AI_DISABLED ? null : <as-is/>` or an
 * early `if (AI_DISABLED) return`) and delete nothing: flipping back to false
 * and rebuilding restores everything. The AIGC labeling chain (provenance
 * latch, metadata stamping) stays ungated: with no AI writes the latch never
 * arms and exports carry no stamp, so that code simply lies dormant.
 */
export const AI_DISABLED = true
