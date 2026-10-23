import { taskService } from "@chatbotx.io/business"
import { mcpSpec } from "@/lib/orpc/mcp-annotations"
import {
  possibleErrorsOnDeletingResource,
  possibleErrorsOnFindingResource,
  possibleErrorsOnListingResource,
  possibleErrorsOnMutatingResource,
} from "@/lib/orpc/orpc-error-helper"
import { workspaceTokenAuthAPIForScope } from "@/orpc"
import { apiTokenActor } from "../lib/actor"
import { parseTaskAssignee, requireTaskAssignee } from "../lib/assignee"
import { withTaskUrl, withTaskUrls } from "../lib/task-url"
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
  taskWatcherPublicRequest,
  updateTaskPublicRequest,
} from "../schema/public"

const workspaceTokenAuthAPI = workspaceTokenAuthAPIForScope("tasks")
const defaultTool = mcpSpec({ visibility: "default" })
const tags = ["Tasks"]

const taskIdFrom =
  "Get task ids from `tasks.list` (or the `id` returned by `tasks.create`)."

const taskCommentsPublicRouter = {
  list: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/tasks/{id}/comments",
      summary: "List task comments",
      description: `${taskIdFrom} Returns the task's feed, newest first: comments and \`system\` change events (created, status, due date, assignee, priority). Returns \`{ data, pageCount }\`; page with \`page\`/\`perPage\`.`,
      tags,
    })
    .input(listTaskCommentsPublicRequest)
    .output(listTaskCommentsPublicResponse)
    .errors(possibleErrorsOnFindingResource)
    .handler(
      async ({ context, input }) =>
        await taskService.listComments({
          workspaceId: context.workspace.id,
          id: input.id,
          page: input.page,
          perPage: input.perPage,
        }),
    ),

  create: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/tasks/{id}/comments",
      summary: "Comment on task",
      description: `${taskIdFrom} Adds a comment to the task's feed on behalf of the API token (its name is shown as the author).`,
      successStatus: 201,
      tags,
    })
    .input(createTaskCommentPublicRequest)
    .output(taskCommentPublicResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(
      async ({ context, input }) =>
        await taskService.addComment({
          workspaceId: context.workspace.id,
          id: input.id,
          text: input.text,
          actor: apiTokenActor(context.apiToken),
        }),
    ),
}

export const tasksPublicRouter = {
  list: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/tasks",
      summary: "List tasks",
      description:
        "Finds staff tasks by status, priority, due date, assignee, creator, watcher, contact or conversation. Filter ids: `assigneeUserId`, `createdByUserId`, `watcherUserId`, and `teamMemberUserId` from `workspaceMembers.list` (`userId`); `assigneeTeamId` from `inboxTeams.list`; `contactId` from `contacts.list`; `conversationId` from `conversations.list`. Sorted by due date (tasks without one last), then priority (urgent first), then newest. Returns `{ data, pageCount }`; page with `page`/`perPage`.",
      spec: defaultTool,
      tags,
    })
    .input(listTasksPublicRequest)
    .output(listTasksPublicResponse)
    .errors(possibleErrorsOnListingResource)
    .handler(async ({ context, input }) => {
      const page = await taskService.list({
        ...input,
        workspaceId: context.workspace.id,
      })
      return {
        ...page,
        data: await withTaskUrls(context.workspace.id, page.data),
      }
    }),

  count: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/tasks/count",
      summary: "Count tasks",
      description:
        "Counts staff tasks with the same filters as `tasks.list`. Filter ids: `assigneeUserId`, `createdByUserId`, `watcherUserId`, and `teamMemberUserId` from `workspaceMembers.list` (`userId`); `assigneeTeamId` from `inboxTeams.list`; `contactId` from `contacts.list`; `conversationId` from `conversations.list`. Returns `{ total }`.",

      tags,
    })
    .input(countTasksPublicRequest)
    .output(countTasksResponse)
    .errors(possibleErrorsOnListingResource)
    .handler(
      async ({ context, input }) =>
        await taskService.count({
          ...input,
          workspaceId: context.workspace.id,
        }),
    ),

  get: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/tasks/{id}",
      summary: "Get task",
      description: `Returns one task with its watchers and linked contact, conversation and message. ${taskIdFrom}`,
      tags,
    })
    .input(taskIdPathParam)
    .output(taskPublicResource)
    .errors(possibleErrorsOnFindingResource)
    .handler(async ({ context, input }) =>
      withTaskUrl(
        await taskService.get({
          workspaceId: context.workspace.id,
          id: input.id,
        }),
      ),
    ),

  create: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/tasks",
      summary: "Create task",
      description:
        "Assigns a task to a workspace member (`assigneeUserId` from `workspaceMembers.list`) or a team (`assigneeTeamId` from `inboxTeams.list`). Optional links: `contactId` from `contacts.list`, `conversationId` from `conversations.list`, `messageId` from `messages.list` (requires `conversationId`); extra `watcherUserIds` from `workspaceMembers.list`. The API token's name is recorded as the creator.",
      successStatus: 201,
      spec: defaultTool,
      tags,
    })
    .input(createTaskPublicRequest)
    .output(taskPublicResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) =>
      withTaskUrl(
        await taskService.create({
          workspaceId: context.workspace.id,
          actor: apiTokenActor(context.apiToken),
          title: input.title,
          description: input.description,
          priority: input.priority,
          dueAt: input.dueAt,
          remindAt: input.remindAt,
          assignee: requireTaskAssignee(input),
          watcherUserIds: input.watcherUserIds,
          targets: {
            contactId: input.contactId,
            conversationId: input.conversationId,
            messageId: input.messageId,
          },
        }),
      ),
    ),

  update: workspaceTokenAuthAPI
    .route({
      method: "PATCH",
      path: "/v1/tasks/{id}",
      summary: "Update task",
      description: `${taskIdFrom} Changes only the given fields. New assignee: \`assigneeUserId\` from \`workspaceMembers.list\`, \`assigneeTeamId\` from \`inboxTeams.list\`. Each change of status, due date, assignee or priority is written to the task feed (\`tasks.comments.list\`). Moving the due date or reminder re-arms its notification.`,
      tags,
    })
    .input(updateTaskPublicRequest)
    .output(taskPublicResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) => {
      const { id, assigneeUserId, assigneeTeamId, ...fields } = input
      return await withTaskUrl(
        await taskService.update({
          workspaceId: context.workspace.id,
          id,
          actor: apiTokenActor(context.apiToken),
          patch: {
            ...fields,
            assignee: parseTaskAssignee({ assigneeUserId, assigneeTeamId }),
          },
        }),
      )
    }),

  complete: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/tasks/{id}/complete",
      summary: "Complete task",
      description: `${taskIdFrom} Marks the task \`done\`. Same as \`tasks.update\` with \`status: "done"\`.`,
      tags,
    })
    .input(taskIdPathParam)
    .output(taskPublicResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) =>
      withTaskUrl(
        await taskService.complete({
          workspaceId: context.workspace.id,
          id: input.id,
          actor: apiTokenActor(context.apiToken),
        }),
      ),
    ),

  take: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/tasks/{id}/take",
      summary: "Take team task",
      description: `Moves a task assigned to a team to one member of that team. \`userId\` from \`workspaceMembers.list\` (must be in the team; team members from \`inboxTeams.list\`). ${taskIdFrom}`,
      tags,
    })
    .input(takeTaskPublicRequest)
    .output(taskPublicResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) =>
      withTaskUrl(
        await taskService.take({
          workspaceId: context.workspace.id,
          id: input.id,
          userId: input.userId,
          actor: apiTokenActor(context.apiToken),
        }),
      ),
    ),

  delete: workspaceTokenAuthAPI
    .route({
      method: "DELETE",
      path: "/v1/tasks/{id}",
      summary: "Delete task",
      description: `${taskIdFrom} Permanently deletes the task with its feed, watchers and links. Prefer \`tasks.update\` with \`status: "canceled"\` to keep history.`,
      successStatus: 204,
      tags,
    })
    .input(taskIdPathParam)
    .errors(possibleErrorsOnDeletingResource)
    .handler(async ({ context, input }) => {
      await taskService.delete({
        workspaceId: context.workspace.id,
        id: input.id,
        actor: apiTokenActor(context.apiToken),
      })
    }),

  addWatcher: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/tasks/{id}/watchers",
      summary: "Add task watcher",
      description: `${taskIdFrom} Adds a workspace member (\`userId\` from \`workspaceMembers.list\`) to the task's watchers.`,
      tags,
    })
    .input(taskWatcherPublicRequest)
    .output(taskPublicResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) =>
      withTaskUrl(
        await taskService.addWatcher({
          workspaceId: context.workspace.id,
          id: input.id,
          userId: input.userId,
          actor: apiTokenActor(context.apiToken),
        }),
      ),
    ),

  removeWatcher: workspaceTokenAuthAPI
    .route({
      method: "DELETE",
      path: "/v1/tasks/{id}/watchers/{userId}",
      summary: "Remove task watcher",
      description: `${taskIdFrom} Removes a member (\`userId\` from \`workspaceMembers.list\`, or from \`tasks.get\` \`watcherUserIds\`).`,
      successStatus: 204,
      tags,
    })
    .input(taskWatcherPublicRequest)
    .errors(possibleErrorsOnDeletingResource)
    .handler(async ({ context, input }) => {
      await taskService.removeWatcher({
        workspaceId: context.workspace.id,
        id: input.id,
        userId: input.userId,
        actor: apiTokenActor(context.apiToken),
      })
    }),

  comments: taskCommentsPublicRouter,
}
