"use client"

import { Button, buttonVariants } from "@chatbotx.io/ui/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@chatbotx.io/ui/components/ui/tooltip"
import { cn } from "@chatbotx.io/ui/lib/utils"
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query"
import {
  BotIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  TriangleAlertIcon,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useFormatter, useTranslations } from "next-intl"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { CreateTaskDialog } from "@/features/tasks/components/create-task-dialog"
import {
  canCreateTaskFromChatMessage,
  toTaskDescriptionFromChatMessage,
} from "@/features/tasks/lib/message-quote"
import { orpc } from "@/lib/orpc/query"
import { useInvalidateChats } from "../hooks/use-invalidate-chats"
import { useStaffAssistantTyping } from "../hooks/use-staff-assistant-typing"
import { canMutateChat } from "../lib/chat-controls"
import { groupChatMessages } from "../lib/message-groups"
import { mergeChatMessagePages } from "../lib/message-pages"
import { canMarkChatRead } from "../lib/read-throttle"
import { ChatComposer } from "./chat-composer"

const ownChatBubbleClass = "rounded-ee-md bg-primary text-primary-foreground"
const otherChatBubbleClass = "rounded-es-md bg-secondary"

type ChatsPageProps = {
  isBlocked: boolean
  currentUserId: string
  isSupportSession: boolean
  selectedChatId?: string
  workspaceId: string
}

export const ChatsPage = ({
  currentUserId,
  isBlocked,
  isSupportSession,
  selectedChatId,
  workspaceId,
}: ChatsPageProps) => {
  const t = useTranslations()
  const format = useFormatter()
  const router = useRouter()
  const invalidateChats = useInvalidateChats()
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState("")
  const [taskMessageId, setTaskMessageId] = useState<string | null>(null)
  const canCreate = canMutateChat({ isBlocked, isSupportSession })
  const threadRef = useRef<HTMLDivElement>(null)
  const previousScrollHeight = useRef<number | null>(null)
  const { data: chats } = useQuery(
    orpc.chatsAPI.list.queryOptions({
      input: {
        includeEmpty: Boolean(selectedChatId),
        page: 1,
        perPage: 50,
        workspaceId,
      },
    }),
  )
  const { data: selectedChat } = useQuery(
    orpc.chatsAPI.get.queryOptions({
      input: { id: selectedChatId ?? "0", workspaceId },
      enabled: Boolean(selectedChatId),
    }),
  )
  const { data: assistantStatus } = useQuery(
    orpc.chatsAPI.assistantStatus.queryOptions({
      input: { workspaceId },
      enabled: !isSupportSession,
    }),
  )
  const assistantTyping = useStaffAssistantTyping({
    assistantRunning: Boolean(
      selectedChat?.id === selectedChatId && selectedChat?.assistantRunning,
    ),
    isSupportSession,
    selectedChatId,
  })
  const messagePages = useInfiniteQuery(
    orpc.chatsAPI.messages.list.infiniteOptions({
      enabled: Boolean(selectedChatId),
      input: (beforeId: string | undefined) => ({
        beforeId,
        id: selectedChatId ?? "0",
        limit: 50,
        workspaceId,
      }),
      initialPageParam: undefined,
      getNextPageParam: (page) => (page.hasMore ? page.data[0]?.id : undefined),
    }),
  )
  const messages = messagePages.data
    ? mergeChatMessagePages(messagePages.data.pages.map((page) => page.data))
    : undefined
  const messageGroups = messages ? groupChatMessages(messages) : []
  const taskMessage = messages?.find((message) => message.id === taskMessageId)
  const { data: members } = useQuery(
    orpc.workspaceMembersAPI.listWorkspaceMembersAuthenticatedAPI.queryOptions({
      input: { page: 1, perPage: 100, workspaceId },
      enabled: !isSupportSession,
    }),
  )
  const open = useMutation(
    orpc.chatsAPI.open.mutationOptions({
      onSuccess: async ({ chat }) => {
        await invalidateChats()
        router.push(`/space/${workspaceId}/chats/${chat.id}`)
      },
    }),
  )
  const openAssistant = useMutation(
    orpc.chatsAPI.openAssistant.mutationOptions({
      onSuccess: async ({ chat }) => {
        await invalidateChats()
        router.push(`/space/${workspaceId}/chats/${chat.id}`)
      },
    }),
  )
  const markRead = useMutation(
    orpc.chatsAPI.markRead.mutationOptions({
      onSuccess: async () => await invalidateChats(),
    }),
  )
  const updateMessage = useMutation(
    orpc.chatsAPI.messages.update.mutationOptions({
      onSuccess: async () => {
        setEditingMessageId(null)
        await invalidateChats()
      },
    }),
  )
  const deleteMessage = useMutation(
    orpc.chatsAPI.messages.delete.mutationOptions({
      onSuccess: async () => await invalidateChats(),
    }),
  )
  const lastMarkedReadAt = useRef(0)
  const titleFor = (chat: {
    members: Array<{ name: string | null; userId: string }>
    title: string | null
  }) =>
    chat.title ??
    chat.members.find((member) => member.userId !== currentUserId)?.name ??
    t("fields.tokenScopes.chats")
  const dateLabel = (value: Date) =>
    format.dateTime(value, { dateStyle: "medium" })

  useEffect(() => {
    const newestMessage = messages?.at(-1)
    if (!(selectedChatId && newestMessage)) {
      return
    }
    if (
      !canMarkChatRead({
        hasMessage: Boolean(newestMessage),
        isPending: markRead.isPending,
        isSupportSession,
        lastMarkedAt: lastMarkedReadAt.current,
        now: Date.now(),
      })
    ) {
      return
    }
    lastMarkedReadAt.current = Date.now()
    markRead.mutate({
      id: selectedChatId,
      upToMessageId: newestMessage.id,
      workspaceId,
    })
  }, [isSupportSession, markRead, messages, selectedChatId, workspaceId])

  // biome-ignore lint/correctness/useExhaustiveDependencies: restore scroll after message pages change
  useEffect(() => {
    if (!(threadRef.current && previousScrollHeight.current !== null)) {
      return
    }
    threadRef.current.scrollTop +=
      threadRef.current.scrollHeight - previousScrollHeight.current
    previousScrollHeight.current = null
  }, [messages])

  const loadOlderMessages = () => {
    if (threadRef.current) {
      previousScrollHeight.current = threadRef.current.scrollHeight
    }
    messagePages.fetchNextPage()
  }

  return (
    <div className="grid min-h-[calc(100vh-10rem)] gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <aside className="rounded-md border">
        <div className="flex items-center justify-between border-b p-3">
          <h1 className="font-semibold">{t("fields.tokenScopes.chats")}</h1>
          {canCreate ? (
            <details className="relative">
              <summary
                aria-label={t("actions.addNew")}
                className={`${buttonVariants({ size: "icon", variant: "outline" })} list-none [&::-webkit-details-marker]:hidden`}
              >
                <PlusIcon aria-hidden="true" />
              </summary>
              <div className="absolute end-0 z-10 mt-2 max-h-72 w-64 overflow-auto rounded-md border bg-popover p-1 shadow-md">
                {assistantStatus?.available ? (
                  <Button
                    className="w-full justify-start"
                    disabled={openAssistant.isPending}
                    onClick={() => openAssistant.mutate({ workspaceId })}
                    type="button"
                    variant="ghost"
                  >
                    <BotIcon aria-hidden="true" />
                    {assistantStatus.name ?? t("staffAssistant.title")}
                  </Button>
                ) : null}
                {members?.data
                  .filter((member) => member.userId !== currentUserId)
                  .map((member) => (
                    <Button
                      className="w-full justify-start"
                      key={member.id}
                      onClick={() =>
                        open.mutate({ userIds: [member.userId], workspaceId })
                      }
                      type="button"
                      variant="ghost"
                    >
                      {member.user.name ?? member.userId}
                    </Button>
                  ))}
              </div>
            </details>
          ) : null}
        </div>
        <nav aria-label={t("fields.tokenScopes.chats")} className="p-1">
          {chats?.data.map((chat) => (
            <Link
              className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-muted"
              href={`/space/${workspaceId}/chats/${chat.id}`}
              key={chat.id}
            >
              <span className="flex min-w-0 items-center gap-2">
                {chat.isStaffAssistant ? (
                  <BotIcon aria-hidden="true" className="size-4 shrink-0" />
                ) : null}
                <span className="min-w-0">
                  <span className="block truncate">{titleFor(chat)}</span>
                  {chat.isStaffAssistant && assistantTyping[chat.id] ? (
                    <span
                      aria-live="polite"
                      className="block text-muted-foreground text-xs"
                    >
                      {t("staffAssistant.typing")}
                    </span>
                  ) : null}
                </span>
              </span>
              {chat.unreadCount ? (
                <span className="ms-2 rounded-full bg-primary px-2 text-primary-foreground text-xs">
                  {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                </span>
              ) : null}
            </Link>
          ))}
          {chats?.data.length === 0 ? (
            <p className="p-3 text-muted-foreground text-sm">
              {t("actions.noRecordFound")}
            </p>
          ) : null}
        </nav>
      </aside>
      <section className="flex min-h-0 flex-col rounded-md border">
        {selectedChat && selectedChatId ? (
          <>
            <header className="flex items-center justify-between border-b p-3 font-semibold">
              <span className="flex items-center gap-2">
                {selectedChat.isStaffAssistant ? (
                  <BotIcon aria-hidden="true" className="size-4" />
                ) : null}
                {titleFor(selectedChat)}
              </span>
              {isSupportSession ? (
                <span className="text-muted-foreground text-sm">
                  {t("fields.tokenPermission.readOnly")}
                </span>
              ) : null}
            </header>
            <div
              className="flex-1 space-y-3 overflow-y-auto p-3"
              ref={threadRef}
            >
              {messagePages.hasNextPage ? (
                <Button
                  disabled={messagePages.isFetchingNextPage}
                  onClick={loadOlderMessages}
                  type="button"
                  variant="ghost"
                >
                  {t("actions.more")}
                </Button>
              ) : null}
              {messageGroups.map((group, groupIndex) => (
                <div className="flex flex-col gap-1" key={group[0].id}>
                  {groupIndex === 0 ||
                  dateLabel(
                    messageGroups[groupIndex - 1].at(-1)?.createdAt ??
                      group[0].createdAt,
                  ) !== dateLabel(group[0].createdAt) ? (
                    <div className="py-2 text-center text-muted-foreground text-xs">
                      {dateLabel(group[0].createdAt)}
                    </div>
                  ) : null}
                  {group.map((message, messageIndex) => {
                    if (
                      message.kind === "system" &&
                      message.systemEvent?.type === "assistantFailed"
                    ) {
                      return (
                        <p
                          className="flex items-center justify-center gap-2 text-center text-muted-foreground text-sm"
                          key={message.id}
                          role="status"
                        >
                          <TriangleAlertIcon
                            aria-hidden="true"
                            className="size-4"
                          />
                          {message.systemEvent.reason === "timeout"
                            ? t("staffAssistant.failedTimeout")
                            : t("staffAssistant.failedUnavailable")}
                        </p>
                      )
                    }

                    const isOwn = message.authorUserId === currentUserId
                    const isEditing = editingMessageId === message.id
                    const showStandaloneTime = !(
                      message.deleted ||
                      isEditing ||
                      message.text
                    )
                    const sentAtLabel = format.dateTime(message.createdAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                    const sentAtTime = format.dateTime(message.createdAt, {
                      timeStyle: "short",
                    })

                    return (
                      <article
                        className={cn(
                          "flex flex-col gap-1",
                          isEditing
                            ? "w-full"
                            : cn(
                                "w-fit max-w-[min(100%,32rem)]",
                                isOwn ? "ms-auto items-end" : "items-start",
                              ),
                        )}
                        key={message.id}
                      >
                        {messageIndex === 0 && !isOwn && message.authorLabel ? (
                          <span className="px-1 text-muted-foreground text-xs">
                            {message.authorLabel}
                          </span>
                        ) : null}
                        {message.deleted ? (
                          <div
                            className={cn(
                              "flex flex-col gap-1 rounded-2xl px-3 py-2 opacity-80",
                              isOwn
                                ? ownChatBubbleClass
                                : cn(
                                    otherChatBubbleClass,
                                    "text-muted-foreground",
                                  ),
                            )}
                          >
                            <p className="text-sm italic">
                              {t("actions.delete")}
                            </p>
                            <time
                              className={cn(
                                "self-end text-[11px] leading-none",
                                isOwn
                                  ? "text-primary-foreground/75"
                                  : "text-muted-foreground",
                              )}
                              dateTime={message.createdAt.toISOString()}
                              title={sentAtLabel}
                            >
                              {sentAtTime}
                            </time>
                          </div>
                        ) : null}
                        {!message.deleted && isEditing ? (
                          <div className="flex gap-2">
                            <textarea
                              className="min-h-20 flex-1 rounded-md border bg-background p-2 text-sm"
                              onChange={(event) =>
                                setEditingText(event.target.value)
                              }
                              value={editingText}
                            />
                            <Button
                              disabled={
                                !editingText.trim() || updateMessage.isPending
                              }
                              onClick={() =>
                                updateMessage.mutate({
                                  id: selectedChatId,
                                  messageId: message.id,
                                  text: editingText.trim(),
                                  workspaceId,
                                })
                              }
                              type="button"
                            >
                              {t("actions.save")}
                            </Button>
                            <Button
                              onClick={() => setEditingMessageId(null)}
                              type="button"
                              variant="ghost"
                            >
                              {t("actions.cancel")}
                            </Button>
                          </div>
                        ) : null}
                        {!(message.deleted || isEditing) && message.text ? (
                          <div
                            className={cn(
                              "flex flex-col gap-1 rounded-2xl px-3 py-2",
                              isOwn ? ownChatBubbleClass : otherChatBubbleClass,
                            )}
                          >
                            <p className="wrap-break-word whitespace-pre-wrap text-sm">
                              {message.text}
                            </p>
                            <time
                              className={cn(
                                "self-end text-[11px] leading-none",
                                isOwn
                                  ? "text-primary-foreground/75"
                                  : "text-muted-foreground",
                              )}
                              dateTime={message.createdAt.toISOString()}
                              title={sentAtLabel}
                            >
                              {sentAtTime}
                            </time>
                          </div>
                        ) : null}
                        {message.attachments.map((attachment) => (
                          <div key={attachment.index}>
                            {attachment.mimeType.startsWith("image/") ? (
                              <a
                                href={attachment.url}
                                rel="noreferrer"
                                target="_blank"
                              >
                                <Image
                                  alt={attachment.name}
                                  className="max-h-64 rounded-md object-contain"
                                  height={256}
                                  src={attachment.url}
                                  unoptimized
                                  width={384}
                                />
                              </a>
                            ) : null}
                            <a
                              className="block text-primary text-sm underline"
                              href={attachment.url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {attachment.name}
                            </a>
                          </div>
                        ))}
                        {showStandaloneTime ? (
                          <time
                            className="text-muted-foreground text-xs"
                            dateTime={message.createdAt.toISOString()}
                            title={sentAtLabel}
                          >
                            {sentAtTime}
                          </time>
                        ) : null}
                        {canCreate && canCreateTaskFromChatMessage(message) ? (
                          <div className="flex gap-0.5">
                            {isOwn ? (
                              <>
                                <ChatMessageIconButton
                                  label={t("actions.edit")}
                                  onClick={() => {
                                    setEditingMessageId(message.id)
                                    setEditingText(message.text ?? "")
                                  }}
                                >
                                  <PencilIcon aria-hidden="true" />
                                </ChatMessageIconButton>
                                <ChatMessageIconButton
                                  disabled={deleteMessage.isPending}
                                  label={t("actions.delete")}
                                  onClick={() =>
                                    deleteMessage.mutate({
                                      id: selectedChatId,
                                      messageId: message.id,
                                      workspaceId,
                                    })
                                  }
                                >
                                  <TrashIcon aria-hidden="true" />
                                </ChatMessageIconButton>
                              </>
                            ) : null}
                            <ChatMessageIconButton
                              label={t("tasks.actions.createFromMessage")}
                              onClick={() => setTaskMessageId(message.id)}
                            >
                              <ListChecksIcon aria-hidden="true" />
                            </ChatMessageIconButton>
                          </div>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              ))}
              {messages?.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm">
                  {t("actions.noRecordFound")}
                </p>
              ) : null}
              {selectedChat.type === "direct" && selectedChat.peerLastReadAt ? (
                <time
                  className="block text-end text-muted-foreground text-xs"
                  dateTime={selectedChat.peerLastReadAt.toISOString()}
                  title={format.dateTime(selectedChat.peerLastReadAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                >
                  {format.dateTime(selectedChat.peerLastReadAt, {
                    timeStyle: "short",
                  })}
                </time>
              ) : null}
              {selectedChat.isStaffAssistant &&
              assistantTyping[selectedChat.id] ? (
                <div
                  aria-label={t("staffAssistant.typing")}
                  aria-live="polite"
                  className="inline-flex gap-1 rounded-2xl rounded-es-md bg-secondary p-3"
                  role="status"
                >
                  {[0, 1, 2].map((dot) => (
                    <span
                      aria-hidden="true"
                      className="size-1.5 animate-pulse rounded-full bg-muted-foreground"
                      key={dot}
                    />
                  ))}
                </div>
              ) : null}
            </div>
            {selectedChat.isStaffAssistant &&
            !isSupportSession &&
            assistantStatus &&
            !assistantStatus.available ? (
              <p className="border-t p-3 text-muted-foreground text-sm">
                {t("staffAssistant.unavailable")}
              </p>
            ) : null}
            {(!selectedChat.isStaffAssistant || assistantStatus?.available) &&
            canMutateChat({
              hasRemovedPeer: selectedChat.members.some(
                (member) => member.userId !== currentUserId && member.removed,
              ),
              isBlocked,
              isSupportSession,
            }) ? (
              <ChatComposer chatId={selectedChatId} workspaceId={workspaceId} />
            ) : null}
            {taskMessage ? (
              <CreateTaskDialog
                defaultDescription={toTaskDescriptionFromChatMessage({
                  author:
                    taskMessage.authorLabel ?? t("tasks.chat.unknownAuthor"),
                  date: format.dateTime(taskMessage.createdAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
                  text: taskMessage.text ?? "",
                })}
                descriptionHint={t("tasks.chat.quoteVisibilityHint")}
                onOpenChange={(open) => {
                  if (!open) {
                    setTaskMessageId(null)
                  }
                }}
                open
                workspaceId={workspaceId}
              />
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  )
}

type ChatMessageIconButtonProps = {
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
}

const ChatMessageIconButton = ({
  children,
  disabled,
  label,
  onClick,
}: ChatMessageIconButtonProps) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <Button
          aria-label={label}
          className="size-7"
          disabled={disabled}
          onClick={onClick}
          size="icon"
          type="button"
          variant="ghost"
        >
          {children}
        </Button>
      }
    />
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
)
