import { taskService } from "@chatbotx.io/business"
import { zodBigintAsString } from "@chatbotx.io/utils"
import type z from "zod"
import { withWorkspaceIdSchema } from "@/features/workspaces/schema/resource"
import { workspaceAuthorizedMidddleware } from "@/middlewares/auth"
import { authorizedAPI } from "@/orpc"
import { parseTaskAssignee, requireTaskAssignee } from "../lib/assignee"
import {
  sessionTaskAccessScope,
  sessionTaskActor,
  tabToFilter,
} from "../lib/session"
import {
  countTasksPublicRequest,
  countTasksResponse,
  createTaskCommentPublicRequest,
  createTaskPublicRequest,
  listTaskCommentsPublicRequest,
  listTaskCommentsPublicResponse,
  listTasksPublicRequest,
  listTasksPublicResponse,
  takeTaskPublicRequest,
  taskCommentPublicResource,
  taskIdPathParam,
  taskPublicResource,
  taskTabs,
  taskWatcherPublicRequest,
  updateTaskPublicRequest,
} from "../schema/public"

const tags = ["Tasks"]

const withWorkspaceTab = <T extends z.ZodObject<z.ZodRawShape>>(schema: T) =>
  schema.extend({
    workspaceId: zodBigintAsString(),
    tab: taskTabs.default("all"),
  })

const listTasksPrivateRequest = withWorkspaceTab(listTasksPublicRequest)
const countTasksPrivateRequest = withWorkspaceTab(countTasksPublicRequest)

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
    .handler(
      async ({ input }) =>
        await taskService.listComments({
          workspaceId: input.workspaceId,
          id: input.id,
          page: input.page,
          perPage: input.perPage,
        }),
    ),

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
    .handler(
      async ({ context, input }) =>
        await taskService.addComment({
          workspaceId: input.workspaceId,
          id: input.id,
          text: input.text,
          actor: sessionTaskActor(context),
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
    .output(listTasksPublicResponse)
    .handler(async ({ context, input }) => {
      const { workspaceId, tab, ...rest } = input
      return await taskService.list({
        ...rest,
        ...tabToFilter(tab, context.user.id),
        workspaceId,
        accessScope: sessionAccessScope(context),
      })
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
    .output(taskPublicResource)
    .handler(
      async ({ context, input }) =>
        await taskService.get({
          workspaceId: input.workspaceId,
          id: input.id,
          accessScope: sessionAccessScope(context),
        }),
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
      return await taskService.create({
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
      })
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
      return await taskService.update({
        workspaceId,
        id,
        actor: sessionTaskActor(context),
        patch: {
          ...fields,
          assignee: parseTaskAssignee({ assigneeUserId, assigneeTeamId }),
        },
      })
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
    .handler(
      async ({ context, input }) =>
        await taskService.complete({
          workspaceId: input.workspaceId,
          id: input.id,
          actor: sessionTaskActor(context),
        }),
    ),

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
    .handler(
      async ({ context, input }) =>
        await taskService.take({
          workspaceId: input.workspaceId,
          id: input.id,
          userId: context.user.id,
          actor: sessionTaskActor(context),
        }),
    ),

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
    .handler(
      async ({ context, input }) =>
        await taskService.addWatcher({
          workspaceId: input.workspaceId,
          id: input.id,
          userId: input.userId,
          actor: sessionTaskActor(context),
        }),
    ),

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
    }),

  comments: taskCommentsPrivateRouter,
}
