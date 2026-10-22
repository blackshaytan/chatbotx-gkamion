/** Shown to the client once a manager joins a conversation the AI agent handed over. */
export const EXTERNAL_AGENT_MANAGER_JOIN_CLIENT_TEXT = "Вам отвечает менеджер"

/** «Вам отвечает менеджер {name}», or the bare notice when the manager has no name. */
export const buildManagerJoinClientText = (
  managerName: string | null | undefined,
): string => {
  const name = managerName?.trim()
  return name
    ? `${EXTERNAL_AGENT_MANAGER_JOIN_CLIENT_TEXT} ${name}`
    : EXTERNAL_AGENT_MANAGER_JOIN_CLIENT_TEXT
}
