import { taskService } from "@chatbotx.io/business"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { withWorkspaceIdSchema } from "@/features/workspaces/schema/resource"
import { workspaceAuthorizedMidddleware } from "@/middlewares/auth"
import { authorizedAPI } from "@/orpc"
import { parseTaskAssignee, requireTaskAssignee } from "../lib/assignee"
import {
  withCommentAttachmentUrls,
  withSingleCommentAttachmentUrls,
} from "../lib/attachment-url"
import {
  sessionTaskAccessScope,
  sessionTaskActor,
  tabToFilter,
} from "../lib/session"
import {
  publishTaskChanged,
  publishTaskCommentsAndTaskChanged,
} from "../lib/task-realtime"
import { withTaskUrl, withTaskUrls } from "../lib/task-url"
import {
  countTasksPublicRequest,
  countTasksResponse,
  createTaskCommentPublicRequest,
  createTaskPublicRequest,
  listTaskCommentsPublicRequest,
  listTaskCommentsPublicResponse,
  listTasksPrivateResponse,
  listTasksPublicRequest,
  takeTaskPublicRequest,
  taskCommentIdPathParam,
  taskCommentPublicResource,
  taskIdPathParam,
  taskPrivateResource,
  taskPublicResource,
  taskTabs,
  taskWatcherPublicRequest,
  updateTaskCommentPublicRequest,
  updateTaskPublicRequest,
  uploadTaskAttachmentRequest,
  uploadTaskAttachmentResponse,
} from "../schema/public"

const tags = ["Tasks"]

const privateListFields = {
  workspaceId: zodBigintAsString(),
  tab: taskTabs.default("all"),
}

const listTasksPrivateRequest = listTasksPublicRequest.extend(privateListFields)
const countTasksPrivateRequest =
  countTasksPublicRequest.extend(privateListFields)

const sessionAccessScope = (context: {
  user: { id: string }
  workspaceMember: {
    permissions: Parameters<typeof sessionTaskAccessScope>[0]["permissions"]
  }
}) =>
  sessionTaskAccessScope({
    permissions: context.workspaceMember.permissions,
    userId: context.user.id,
  })

const taskCommentsPrivateRouter = {
  list: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/tasks/{id}/comments",
      summary: "List task comments",
      tags,
    })
    .input(
      listTaskCommentsPublicRequest.extend({
        workspaceId: zodBigintAsString(),
      }),
    )
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(listTaskCommentsPublicResponse)
    .handler(async ({ input }) => {
      const page = await taskService.listComments({
        workspaceId: input.workspaceId,
        id: input.id,
        page: input.page,
        perPage: input.perPage,
      })
      return {
        ...page,
        data: await withCommentAttachmentUrls(input.workspaceId, page.data),
      }
    }),

  create: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/tasks/{id}/comments",
      summary: "Comment on task",
      successStatus: 201,
      tags,
    })
    .input(
      createTaskCommentPublicRequest.extend({
        workspaceId: zodBigintAsString(),
      }),
    )
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(taskCommentPublicResource)
    .handler(async ({ context, input }) => {
      const comment = await taskService.addComment({
        workspaceId: input.workspaceId,
        id: input.id,
        text: input.text ?? "",
        attachments: input.attachments,
        actor: sessionTaskActor(context),
      })
      publishTaskCommentsAndTaskChanged(input.workspaceId, input.id)
      return await withSingleCommentAttachmentUrls(input.workspaceId, comment)
    }),

  update: authorizedAPI
    .route({
      method: "PATCH",
      path: "/workspaces/{workspaceId}/tasks/{id}/comments/{commentId}",
      summary: "Update task comment",
      tags,
    })
    .input(
      updateTaskCommentPublicRequest.extend({
        workspaceId: zodBigintAsString(),
      }),
    )
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(taskCommentPublicResource)
    .handler(async ({ context, input }) => {
      const comment = await taskService.updateComment({
        workspaceId: input.workspaceId,
        id: input.id,
        commentId: input.commentId,
        text: input.text ?? "",
        actor: sessionTaskActor(context),
      })
      publishTaskCommentsAndTaskChanged(input.workspaceId, input.id)
      return await withSingleCommentAttachmentUrls(input.workspaceId, comment)
    }),

  delete: authorizedAPI
    .route({
      method: "DELETE",
      path: "/workspaces/{workspaceId}/tasks/{id}/comments/{commentId}",
      summary: "Delete task comment",
      successStatus: 204,
      tags,
    })
    .input(
      taskCommentIdPathParam.extend({
        workspaceId: zodBigintAsString(),
      }),
    )
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(async ({ context, input }) => {
      await taskService.deleteComment({
        workspaceId: input.workspaceId,
        id: input.id,
        commentId: input.commentId,
        actor: sessionTaskActor(context),
      })
      publishTaskCommentsAndTaskChanged(input.workspaceId, input.id)
    }),
}

const taskAttachmentsPrivateRouter = {
  upload: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/tasks/{id}/attachments",
      summary: "Upload task attachment",
      successStatus: 201,
      tags,
    })
    .input(
      uploadTaskAttachmentRequest.extend({
        workspaceId: zodBigintAsString(),
      }),
    )
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(uploadTaskAttachmentResponse)
    .handler(
      async ({ input }) =>
        await taskService.uploadAttachment({
          workspaceId: input.workspaceId,
          id: input.id,
          file: input.file,
        }),
    ),
}

export const tasksAuthenticatedAPI = {
  list: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/tasks",
      summary: "List tasks",
      tags,
    })
    .input(listTasksPrivateRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(listTasksPrivateResponse)
    .handler(async ({ context, input }) => {
      const { workspaceId, tab, ...rest } = input
      const page = await taskService.list({
        ...rest,
        ...tabToFilter(tab, context.user.id),
        workspaceId,
        accessScope: sessionAccessScope(context),
        viewerUserId: context.user.id,
      })
      return { ...page, data: await withTaskUrls(workspaceId, page.data) }
    }),

  count: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/tasks/count",
      summary: "Count tasks",
      tags,
    })
    .input(countTasksPrivateRequest)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(countTasksResponse)
    .handler(async ({ context, input }) => {
      const { workspaceId, tab, ...rest } = input
      return await taskService.count({
        ...rest,
        ...tabToFilter(tab, context.user.id),
        workspaceId,
      })
    }),

  get: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/tasks/{id}",
      summary: "Get task",
      tags,
    })
    .input(taskIdPathParam.extend(withWorkspaceIdSchema.shape))
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(taskPrivateResource)
    .handler(async ({ context, input }) =>
      withTaskUrl(
        await taskService.get({
          workspaceId: input.workspaceId,
          id: input.id,
          accessScope: sessionAccessScope(context),
          viewerUserId: context.user.id,
        }),
      ),
    ),

  create: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/tasks",
      summary: "Create task",
      successStatus: 201,
      tags,
    })
    .input(createTaskPublicRequest.extend(withWorkspaceIdSchema.shape))
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(taskPublicResource)
    .handler(async ({ context, input }) => {
      const { workspaceId, ...fields } = input
      const scope = sessionAccessScope(context)
      const task = await taskService.create({
        workspaceId,
        actor: sessionTaskActor(context),
        title: fields.title,
        description: fields.description,
        priority: fields.priority,
        dueAt: fields.dueAt,
        remindAt: fields.remindAt,
        assignee: requireTaskAssignee(fields),
        watcherUserIds: fields.watcherUserIds,
        targets: {
          contactId: fields.contactId,
          conversationId: fields.conversationId,
          messageId: fields.messageId,
        },
        accessScope: scope,
      })
      publishTaskChanged(workspaceId, task.id)
      return await withTaskUrl(task)
    }),

  update: authorizedAPI
    .route({
      method: "PATCH",
      path: "/workspaces/{workspaceId}/tasks/{id}",
      summary: "Update task",
      tags,
    })
    .input(updateTaskPublicRequest.extend(withWorkspaceIdSchema.shape))
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(taskPublicResource)
    .handler(async ({ context, input }) => {
      const { workspaceId, id, assigneeUserId, assigneeTeamId, ...fields } =
        input
      const scope = sessionAccessScope(context)
      const task = await taskService.update({
        workspaceId,
        id,
        actor: sessionTaskActor(context),
        patch: {
          ...fields,
          assignee: parseTaskAssignee({ assigneeUserId, assigneeTeamId }),
        },
        accessScope: scope,
      })
      publishTaskChanged(workspaceId, id)
      return await withTaskUrl(task)
    }),

  complete: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/tasks/{id}/complete",
      summary: "Complete task",
      tags,
    })
    .input(taskIdPathParam.extend(withWorkspaceIdSchema.shape))
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(taskPublicResource)
    .handler(async ({ context, input }) => {
      const task = await taskService.complete({
        workspaceId: input.workspaceId,
        id: input.id,
        actor: sessionTaskActor(context),
        accessScope: sessionAccessScope(context),
      })
      publishTaskChanged(input.workspaceId, input.id)
      return await withTaskUrl(task)
    }),

  take: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/tasks/{id}/take",
      summary: "Take team task",
      tags,
    })
    .input(
      takeTaskPublicRequest
        .omit({ userId: true })
        .extend(withWorkspaceIdSchema.shape),
    )
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(taskPublicResource)
    .handler(async ({ context, input }) => {
      const task = await taskService.take({
        workspaceId: input.workspaceId,
        id: input.id,
        userId: context.user.id,
        actor: sessionTaskActor(context),
        accessScope: sessionAccessScope(context),
      })
      publishTaskChanged(input.workspaceId, input.id)
      return await withTaskUrl(task)
    }),

  delete: authorizedAPI
    .route({
      method: "DELETE",
      path: "/workspaces/{workspaceId}/tasks/{id}",
      summary: "Delete task",
      successStatus: 204,
      tags,
    })
    .input(taskIdPathParam.extend(withWorkspaceIdSchema.shape))
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(async ({ context, input }) => {
      await taskService.delete({
        workspaceId: input.workspaceId,
        id: input.id,
        actor: sessionTaskActor(context),
      })
      publishTaskChanged(input.workspaceId, input.id)
    }),

  addWatcher: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/tasks/{id}/watchers",
      summary: "Add task watcher",
      tags,
    })
    .input(taskWatcherPublicRequest.extend(withWorkspaceIdSchema.shape))
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .output(taskPublicResource)
    .handler(async ({ context, input }) => {
      const task = await taskService.addWatcher({
        workspaceId: input.workspaceId,
        id: input.id,
        userId: input.userId,
        actor: sessionTaskActor(context),
        accessScope: sessionAccessScope(context),
      })
      publishTaskChanged(input.workspaceId, input.id)
      return await withTaskUrl(task)
    }),

  removeWatcher: authorizedAPI
    .route({
      method: "DELETE",
      path: "/workspaces/{workspaceId}/tasks/{id}/watchers/{userId}",
      summary: "Remove task watcher",
      successStatus: 204,
      tags,
    })
    .input(taskWatcherPublicRequest.extend(withWorkspaceIdSchema.shape))
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(async ({ context, input }) => {
      await taskService.removeWatcher({
        workspaceId: input.workspaceId,
        id: input.id,
        userId: input.userId,
        actor: sessionTaskActor(context),
      })
      publishTaskChanged(input.workspaceId, input.id)
    }),

  markRead: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/tasks/{id}/read",
      summary: "Mark task feed read",
      successStatus: 204,
      tags,
    })
    .input(taskIdPathParam.extend(withWorkspaceIdSchema.shape))
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(async ({ context, input }) => {
      await taskService.markRead({
        workspaceId: input.workspaceId,
        id: input.id,
        userId: context.user.id,
      })
    }),

  comments: taskCommentsPrivateRouter,
  attachments: taskAttachmentsPrivateRouter,
}
