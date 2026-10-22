/**
 * Temporary UI gates for the contact side panel (inbox).
 *
 * Flip to `true` to restore the modules we hid while focusing the panel on
 * core contact identity (avatar, ids, channel handles).
 *
 * - `SHOW_CONTACT_CUSTOM_FIELD_ACTIONS` — "Add Custom Field" / "Clear" on the
 *   contact card (`contact-detail.tsx`).
 * - `SHOW_CONTACT_SIDE_PANEL_MODULES` — Notes, Coupons, Appointments, Tags,
 *   Sequences (`contact-inbox-panel.tsx`). Conversation routing stays visible.
 */
export const SHOW_CONTACT_CUSTOM_FIELD_ACTIONS = false
export const SHOW_CONTACT_SIDE_PANEL_MODULES = false
