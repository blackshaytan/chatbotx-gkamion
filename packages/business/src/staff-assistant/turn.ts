import {
  chatRepository,
  externalAgentChatStateRepository,
} from "@chatbotx.io/database/repositories"
import { workspaceMemberService } from "../workspace-member/service"
import { selectNewEmployeeMessages, selectStaffHistory } from "./messages"
import { staffAssistantService } from "./service"

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000
const INITIAL_MESSAGE_LIMIT = 30
const PENDING_MESSAGE_LIMIT = 100

/** Load only the one real member of this staff chat, with no support-session access. */
export const loadStaffAssistantTurn = async (input: {
  workspaceId: string
  threadId: string
}) => {
  const chat = await chatRepository.findAccessible({ ...input, userId: null })
  if (chat?.thread.type !== "agent") {
    return null
  }
  const members = await chatRepository.listMembers({
    workspaceId: input.workspaceId,
    threadIds: [input.threadId],
  })
  const member = members[0]
  if (
    members.length !== 1 ||
    !member?.isWorkspaceMember ||
    chat.thread.directKey !== `agent:${member.userId}:staff`
  ) {
    return null
  }
  const membership = await workspaceMemberService.findMembership({
    workspaceId: input.workspaceId,
    userId: member.userId,
  })
  if (!membership) {
    return null
  }
  const [runtime, state] = await Promise.all([
    staffAssistantService.getRuntime(input.workspaceId),
    externalAgentChatStateRepository.find(input),
  ])
  if (!runtime) {
    return null
  }
  const since = new Date(Date.now() - LOOKBACK_MS)
  const messages = state?.cursorAt
    ? await chatRepository.listStaffEmployeeMessagesAfter({
        ...input,
        userId: member.userId,
        since,
        cursorAt: state.cursorAt,
        cursorMessageId: state.cursorMessageId,
        limit: PENDING_MESSAGE_LIMIT,
      })
    : await chatRepository.listRecentStaffMessages({
        ...input,
        since,
        limit: INITIAL_MESSAGE_LIMIT,
      })
  const newMessages = selectNewEmployeeMessages({
    messages,
    userId: member.userId,
    cursorAt: state?.cursorAt ?? null,
    cursorMessageId: state?.cursorMessageId ?? null,
  })
  return {
    ...input,
    userId: member.userId,
    name: member.name,
    role: membership.role,
    permissions: membership.permissions,
    runtime,
    state,
    newMessages,
    history: state?.cursorAt ? [] : selectStaffHistory(messages, newMessages),
  }
}
