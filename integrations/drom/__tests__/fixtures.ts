import type { DromAuthValue } from "../src/schema"

export const DROM_BASE = "https://baza.drom.ru"

export const dromAuth: DromAuthValue = {
  authType: "secretText",
  secretText: "ring=test-ring; boobs=test-session",
  sellerLogin: "test-seller",
  pollIntervalSeconds: 30,
  maxDialogsPerPoll: 2,
  requestMinIntervalSeconds: 0,
}
