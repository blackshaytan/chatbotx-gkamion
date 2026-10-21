import { Queue } from "bullmq"
import { z } from "zod"
import {
  defaultJobOptions,
  fakeQueue,
  getQueueConnection,
  isNoRedisEnv,
} from "../../lib/connection"
import { queueNames } from "../../lib/types"

export const AI_FILES_DEFAULT_CHUNK_SIZE = 1000
export const AI_FILES_DEFAULT_OVERLAP_SIZE = 200

export const AIJobAction = {
  processAIFile: "processAIFile",
  processPendingEmbedding: "processPendingEmbedding",
  summarizeConversation: "summarizeConversation",
  processConversationSource: "processConversationSource",
  processConversationSourceEmbedding: "processConversationSourceEmbedding",
  processAutomatedResponse: "processAutomatedResponse",
  processHandoffReentry: "processHandoffReentry",
  commentAIReply: "commentAIReply",
  processStoryReplyAutomation: "processStoryReplyAutomation",
  processStoryMentionAutomation: "processStoryMentionAutomation",
  externalAgentReply: "externalAgentReply",
  externalAgentWatch: "externalAgentWatch",
} as const

const EXTERNAL_AGENT_REPLY_DELAY_MS = 5000

export const aiJobSummarizeConversationDataSchema = z.object({
  conversationId: z.string().min(1),
})

const aiJobProcessFileSchema = z.object({
  type: z.literal(AIJobAction.processAIFile),
  data: z.object({ aiFileId: z.string().min(1) }),
})

const aiJobProcessPendingEmbeddingSchema = z.object({
  type: z.literal(AIJobAction.processPendingEmbedding),
  data: z.object({ aiEmbeddingId: z.string().min(1) }),
})

const aiJobSummarizeConversationSchema = z.object({
  type: z.literal(AIJobAction.summarizeConversation),
  data: aiJobSummarizeConversationDataSchema,
})

const aiJobProcessConversationSourceSchema = z.object({
  type: z.literal(AIJobAction.processConversationSource),
  data: z.object({ sourceId: z.string().min(1) }),
})

const aiJobProcessConversationSourceEmbeddingSchema = z.object({
  type: z.literal(AIJobAction.processConversationSourceEmbedding),
  data: z.object({ conversationEmbeddingId: z.string().min(1) }),
})

const aiJobProcessAutomatedResponseSchema = z.object({
  type: z.literal(AIJobAction.processAutomatedResponse),
  data: z.object({
    conversationId: z.string().min(1),
    contactInboxId: z.string().min(1),
    messageId: z.string().min(1),
  }),
})

const aiJobProcessHandoffReentrySchema = z.object({
  type: z.literal(AIJobAction.processHandoffReentry),
  data: z.object({
    conversationId: z.string().min(1),
    contactInboxId: z.string().min(1),
    messageId: z.string().min(1),
  }),
})

const aiJobCommentAIReplySchema = z.object({
  type: z.literal(AIJobAction.commentAIReply),
  data: z.object({
    automationId: z.string().min(1),
    integrationType: z.string().min(1),
    integrationIdentifier: z.string().min(1),
    workspaceId: z.string().min(1),
    conversationId: z.string().min(1),
    contactInboxId: z.string().min(1),
    commentId: z.string().min(1),
    agentId: z.string().min(1),
    replyChannel: z.enum(["public", "private"]),
    channelType: z.enum([
      "messenger",
      "instagram",
      "instagramFacebook",
      "threads",
      "tiktok",
    ]),
    message: z.string().optional(),
    parentMessageId: z.string().nullable().optional(),
    parentMessageCreatedAt: z.string().nullable().optional(),
    // Dedup row written by `processCommentAutomation` when it enqueued this
    // job. Carried so a job that bails out without delivering anything can roll
    // it back instead of leaving the contact blocked forever by
    // `replyOncePerUserPerPost`. Built once at dispatch, never recomposed here.
    commentDedup: z
      .object({
        automationId: z.string().min(1),
        contactId: z.string().min(1),
        postId: z.string().min(1),
        workspaceId: z.string().min(1),
      })
      .optional(),
  }),
})

const aiJobProcessStoryReplyAutomationSchema = z.object({
  type: z.literal(AIJobAction.processStoryReplyAutomation),
  data: z.object({
    workspaceId: z.string().min(1),
    conversationId: z.string().min(1),
    contactInboxId: z.string().min(1),
    messageId: z.string().min(1),
    storyId: z.string().min(1),
    storyUrl: z.string().optional(),
    message: z.string().optional(),
    channelType: z.enum(["instagram", "instagramFacebook"]),
  }),
})

const aiJobProcessStoryMentionAutomationSchema = z.object({
  type: z.literal(AIJobAction.processStoryMentionAutomation),
  data: z.object({
    workspaceId: z.string().min(1),
    conversationId: z.string().min(1),
    contactInboxId: z.string().min(1),
    messageId: z.string().min(1),
    channelType: z.enum(["instagram", "instagramFacebook"]),
  }),
})

const externalAgentJobDataSchema = z.object({
  workspaceId: z.string().min(1),
  conversationId: z.string().min(1),
  contactInboxId: z.string().min(1),
})

const aiJobExternalAgentReplySchema = z.object({
  type: z.literal(AIJobAction.externalAgentReply),
  data: externalAgentJobDataSchema.extend({
    messageId: z.string().min(1),
  }),
})

const aiJobExternalAgentWatchSchema = z.object({
  type: z.literal(AIJobAction.externalAgentWatch),
  data: externalAgentJobDataSchema.extend({
    runId: z.string().min(1),
  }),
})

export const aiJobDataSchema = z.discriminatedUnion("type", [
  aiJobProcessFileSchema,
  aiJobProcessPendingEmbeddingSchema,
  aiJobSummarizeConversationSchema,
  aiJobProcessConversationSourceSchema,
  aiJobProcessConversationSourceEmbeddingSchema,
  aiJobProcessAutomatedResponseSchema,
  aiJobProcessHandoffReentrySchema,
  aiJobCommentAIReplySchema,
  aiJobProcessStoryReplyAutomationSchema,
  aiJobProcessStoryMentionAutomationSchema,
  aiJobExternalAgentReplySchema,
  aiJobExternalAgentWatchSchema,
])

export type AIJobData = z.infer<typeof aiJobDataSchema>
export type AIJobProcessFile = z.infer<typeof aiJobProcessFileSchema>
export type AIJobProcessPendingEmbedding = z.infer<
  typeof aiJobProcessPendingEmbeddingSchema
>
export type AIJobSummarizeConversation = z.infer<
  typeof aiJobSummarizeConversationSchema
>
export type AIJobProcessConversationSource = z.infer<
  typeof aiJobProcessConversationSourceSchema
>
export type AIJobProcessConversationSourceEmbedding = z.infer<
  typeof aiJobProcessConversationSourceEmbeddingSchema
>
export type AIJobProcessAutomatedResponse = z.infer<
  typeof aiJobProcessAutomatedResponseSchema
>
export type AIJobProcessHandoffReentry = z.infer<
  typeof aiJobProcessHandoffReentrySchema
>
export type AIJobCommentAIReply = z.infer<typeof aiJobCommentAIReplySchema>
export type AIJobProcessStoryReplyAutomation = z.infer<
  typeof aiJobProcessStoryReplyAutomationSchema
>
export type AIJobProcessStoryMentionAutomation = z.infer<
  typeof aiJobProcessStoryMentionAutomationSchema
>

export type AIJobExternalAgentReply = z.infer<
  typeof aiJobExternalAgentReplySchema
>
export type AIJobExternalAgentWatch = z.infer<
  typeof aiJobExternalAgentWatchSchema
>
export type ExternalAgentReplyData = AIJobExternalAgentReply["data"]
export type ExternalAgentWatchData = AIJobExternalAgentWatch["data"]

export const aiAgentQueue = isNoRedisEnv()
  ? fakeQueue
  : new Queue<AIJobData>(queueNames.enum.aiAgent, {
      connection: getQueueConnection(queueNames.enum.aiAgent),
      defaultJobOptions,
    })

/**
 * One pending reply per conversation, debounced by 5 s (the latest message
 * wins). No custom `jobId`: BullMQ checks an existing id before deduplication,
 * so a fixed id would swallow every add instead of replacing the delayed job.
 * `keepLastIfActive` keeps one follow-up while a reply is running, so an add
 * from inside a running reply (or while it runs) is not dropped.
 */
export const enqueueExternalAgentReply = (data: ExternalAgentReplyData) =>
  aiAgentQueue.add(
    AIJobAction.externalAgentReply,
    { type: AIJobAction.externalAgentReply, data },
    {
      delay: EXTERNAL_AGENT_REPLY_DELAY_MS,
      deduplication: {
        id: `externalAgentReply-${data.conversationId}`,
        ttl: EXTERNAL_AGENT_REPLY_DELAY_MS,
        extend: true,
        replace: true,
        keepLastIfActive: true,
      },
      attempts: 4,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  )

export const enqueueExternalAgentWatch = (
  data: ExternalAgentWatchData,
  delay = 0,
) =>
  aiAgentQueue.add(
    AIJobAction.externalAgentWatch,
    { type: AIJobAction.externalAgentWatch, data },
    {
      jobId: `externalAgentWatch-${data.conversationId}-${data.runId}-${Date.now()}`,
      delay,
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  )
