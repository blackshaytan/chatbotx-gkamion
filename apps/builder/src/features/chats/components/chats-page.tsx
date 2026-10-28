"use client"

import { Button } from "@chatbotx.io/ui/components/ui/button"
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query"
import { PlusIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useFormatter, useTranslations } from "next-intl"
import { useEffect, useRef, useState } from "react"
import { orpc } from "@/lib/orpc/query"
import { useInvalidateChats } from "../hooks/use-invalidate-chats"
import { canMutateChat } from "../lib/chat-controls"
import { groupChatMessages } from "../lib/message-groups"
import { mergeChatMessagePages } from "../lib/message-pages"
import { canMarkChatRead } from "../lib/read-throttle"
import { ChatComposer } from "./chat-composer"

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
  const canCreate = canMutateChat({ isBlocked, isSupportSession })
  const threadRef = useRef<HTMLDivElement>(null)
  const previousScrollHeight = useRef<number | null>(null)
  const { data: chats } = useQuery(
    orpc.chatsAPI.list.queryOptions({
      input: { includeEmpty: Boolean(selectedChatId), page: 1, perPage: 50, workspaceId },
    }),
  )
  const { data: selectedChat } = useQuery(
    orpc.chatsAPI.get.queryOptions({
      input: { id: selectedChatId ?? "0", workspaceId },
      enabled: Boolean(selectedChatId),
    }),
  )
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
      getNextPageParam: (page) =>
        page.hasMore ? page.data[0]?.id : undefined,
    }),
  )
  const messages = messagePages.data
    ? mergeChatMessagePages(messagePages.data.pages.map((page) => page.data))
    : undefined
  const messageGroups = messages ? groupChatMessages(messages) : []
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
    if (!selectedChatId || !newestMessage || !canMarkChatRead({
      hasMessage: Boolean(newestMessage),
      isPending: markRead.isPending,
      isSupportSession,
      lastMarkedAt: lastMarkedReadAt.current,
      now: Date.now(),
    })) {
      return
    }
    lastMarkedReadAt.current = Date.now()
    markRead.mutate({
      id: selectedChatId,
      upToMessageId: newestMessage.id,
      workspaceId,
    })
  }, [
    isSupportSession,
    markRead,
    messages,
    selectedChatId,
    workspaceId,
  ])

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
              <summary className="list-none">
                <Button aria-label={t("actions.addNew")} size="icon" type="button" variant="outline">
                  <PlusIcon aria-hidden="true" />
                </Button>
              </summary>
              <div className="absolute end-0 z-10 mt-2 max-h-72 w-64 overflow-auto rounded-md border bg-popover p-1 shadow-md">
                {members?.data
                  .filter((member) => member.userId !== currentUserId)
                  .map((member) => (
                    <Button className="w-full justify-start" key={member.id} onClick={() => open.mutate({ userIds: [member.userId], workspaceId })} type="button" variant="ghost">
                      {member.user.name ?? member.userId}
                    </Button>
                  ))}
              </div>
            </details>
          ) : null}
        </div>
        <nav aria-label={t("fields.tokenScopes.chats")} className="p-1">
          {chats?.data.map((chat) => (
            <Link className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-muted" href={`/space/${workspaceId}/chats/${chat.id}`} key={chat.id}>
              <span className="truncate">{titleFor(chat)}</span>
              {chat.unreadCount ? <span className="ms-2 rounded-full bg-primary px-2 text-primary-foreground text-xs">{chat.unreadCount > 99 ? "99+" : chat.unreadCount}</span> : null}
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
              <span>{titleFor(selectedChat)}</span>
              {isSupportSession ? (
                <span className="text-muted-foreground text-sm">
                  {t("fields.tokenPermission.readOnly")}
                </span>
              ) : null}
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto p-3" ref={threadRef}>
              {messagePages.hasNextPage ? (
                <Button disabled={messagePages.isFetchingNextPage} onClick={loadOlderMessages} type="button" variant="ghost">
                  {t("actions.more")}
                </Button>
              ) : null}
              {messageGroups.map((group, groupIndex) => (
                <div className="space-y-3" key={group[0].id}>
                  {groupIndex === 0 ||
                  dateLabel(
                    messageGroups[groupIndex - 1].at(-1)?.createdAt ??
                      group[0].createdAt,
                  ) !== dateLabel(group[0].createdAt) ? (
                    <div className="py-2 text-center text-muted-foreground text-xs">
                      {dateLabel(group[0].createdAt)}
                    </div>
                  ) : null}
                  {group.map((message, messageIndex) => (
                    <article className="space-y-1" key={message.id}>
                  <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
                    <span>{messageIndex === 0 ? message.authorLabel : null}</span>
                    <time>{format.dateTime(message.createdAt, { dateStyle: "medium", timeStyle: "short" })}</time>
                  </div>
                  {message.deleted ? <p className="text-muted-foreground text-sm">{t("actions.delete")}</p> : editingMessageId === message.id ? <div className="flex gap-2"><textarea className="min-h-20 flex-1 rounded-md border bg-background p-2 text-sm" onChange={(event) => setEditingText(event.target.value)} value={editingText} /><Button disabled={!editingText.trim() || updateMessage.isPending} onClick={() => updateMessage.mutate({ id: selectedChatId, messageId: message.id, text: editingText.trim(), workspaceId })} type="button">{t("actions.save")}</Button><Button onClick={() => setEditingMessageId(null)} type="button" variant="ghost">{t("actions.cancel")}</Button></div> : <p className="whitespace-pre-wrap text-sm">{message.text}</p>}
                  {message.attachments.map((attachment) => (
                    <div key={attachment.index}>
                      {attachment.mimeType.startsWith("image/") ? (
                        <a href={attachment.url} rel="noreferrer" target="_blank">
                          <img
                            alt={attachment.name}
                            className="max-h-64 rounded-md object-contain"
                            src={attachment.url}
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
                  {canCreate && message.authorUserId === currentUserId && !message.deleted ? <div className="flex gap-1"><Button onClick={() => { setEditingMessageId(message.id); setEditingText(message.text ?? "") }} size="sm" type="button" variant="ghost">{t("actions.edit")}</Button><Button disabled={deleteMessage.isPending} onClick={() => deleteMessage.mutate({ id: selectedChatId, messageId: message.id, workspaceId })} size="sm" type="button" variant="ghost">{t("actions.delete")}</Button></div> : null}
                  </article>
                  ))}
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
            </div>
            {canMutateChat({
              hasRemovedPeer: selectedChat.members.some(
                (member) => member.userId !== currentUserId && member.removed,
              ),
              isBlocked,
              isSupportSession,
            }) ? (
              <ChatComposer chatId={selectedChatId} workspaceId={workspaceId} />
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  )
}
