CREATE TYPE "internalMessageKind" AS ENUM('comment', 'system');--> statement-breakpoint
CREATE TYPE "internalThreadType" AS ENUM('task');--> statement-breakpoint
CREATE TYPE "taskCreatedBySource" AS ENUM('user', 'flow', 'api');--> statement-breakpoint
CREATE TYPE "taskPriority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "taskStatus" AS ENUM('todo', 'in_progress', 'done', 'canceled');--> statement-breakpoint
CREATE TABLE "InternalMessage" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"threadId" bigint NOT NULL,
	"workspaceId" bigint NOT NULL,
	"kind" "internalMessageKind" NOT NULL,
	"authorUserId" bigint,
	"authorLabel" text,
	"text" text,
	"mentions" jsonb NOT NULL,
	"attachments" jsonb NOT NULL,
	"systemEvent" jsonb,
	"editedAt" timestamp(6) with time zone,
	"deletedAt" timestamp(6) with time zone
);
--> statement-breakpoint
CREATE TABLE "InternalThreadMember" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"threadId" bigint NOT NULL,
	"userId" bigint NOT NULL,
	"lastReadAt" timestamp(6) with time zone
);
--> statement-breakpoint
CREATE TABLE "InternalThread" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"workspaceId" bigint NOT NULL,
	"type" "internalThreadType" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Task" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"workspaceId" bigint NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "taskStatus" DEFAULT 'todo'::"taskStatus" NOT NULL,
	"priority" "taskPriority" DEFAULT 'normal'::"taskPriority" NOT NULL,
	"dueAt" timestamp(6) with time zone,
	"remindAt" timestamp(6) with time zone,
	"assigneeUserId" bigint,
	"assigneeTeamId" bigint,
	"createdByUserId" bigint,
	"createdBySource" "taskCreatedBySource" NOT NULL,
	"createdByLabel" text,
	"threadId" bigint NOT NULL,
	"completedAt" timestamp(6) with time zone,
	"remindedAt" timestamp(6) with time zone,
	"overdueNotifiedAt" timestamp(6) with time zone,
	CONSTRAINT "Task_single_assignee_check" CHECK (num_nonnulls("assigneeUserId", "assigneeTeamId") <= 1),
	CONSTRAINT "Task_remind_before_due_check" CHECK ("remindAt" IS NULL OR "dueAt" IS NULL OR "remindAt" <= "dueAt")
);
--> statement-breakpoint
CREATE TABLE "TaskTarget" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"taskId" bigint NOT NULL,
	"contactId" bigint,
	"conversationId" bigint,
	"messageId" bigint,
	CONSTRAINT "TaskTarget_single_target_check" CHECK (num_nonnulls("contactId", "conversationId", "messageId") = 1)
);
--> statement-breakpoint
CREATE TABLE "TaskWatcher" (
	"id" bigint PRIMARY KEY,
	"createdAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
	"taskId" bigint NOT NULL,
	"userId" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "InternalMessage_threadId_createdAt_idx" ON "InternalMessage" ("threadId","createdAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "InternalMessage_workspaceId_idx" ON "InternalMessage" ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "InternalThreadMember_threadId_userId_key" ON "InternalThreadMember" ("threadId","userId");--> statement-breakpoint
CREATE INDEX "InternalThreadMember_userId_idx" ON "InternalThreadMember" ("userId");--> statement-breakpoint
CREATE INDEX "InternalThread_workspaceId_idx" ON "InternalThread" ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "Task_threadId_key" ON "Task" ("threadId");--> statement-breakpoint
CREATE INDEX "Task_workspaceId_assigneeUserId_status_idx" ON "Task" ("workspaceId","assigneeUserId","status");--> statement-breakpoint
CREATE INDEX "Task_workspaceId_assigneeTeamId_status_idx" ON "Task" ("workspaceId","assigneeTeamId","status");--> statement-breakpoint
CREATE INDEX "Task_workspaceId_createdByUserId_idx" ON "Task" ("workspaceId","createdByUserId");--> statement-breakpoint
CREATE INDEX "Task_workspaceId_dueAt_open_idx" ON "Task" ("workspaceId","dueAt") WHERE "status" IN ('todo', 'in_progress');--> statement-breakpoint
CREATE INDEX "TaskTarget_taskId_idx" ON "TaskTarget" ("taskId");--> statement-breakpoint
CREATE INDEX "TaskTarget_contactId_idx" ON "TaskTarget" ("contactId");--> statement-breakpoint
CREATE INDEX "TaskTarget_conversationId_idx" ON "TaskTarget" ("conversationId");--> statement-breakpoint
CREATE UNIQUE INDEX "TaskWatcher_taskId_userId_key" ON "TaskWatcher" ("taskId","userId");--> statement-breakpoint
CREATE INDEX "TaskWatcher_userId_idx" ON "TaskWatcher" ("userId");--> statement-breakpoint
ALTER TABLE "InternalMessage" ADD CONSTRAINT "InternalMessage_threadId_InternalThread_id_fkey" FOREIGN KEY ("threadId") REFERENCES "InternalThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "InternalMessage" ADD CONSTRAINT "InternalMessage_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "InternalMessage" ADD CONSTRAINT "InternalMessage_authorUserId_User_id_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "InternalThreadMember" ADD CONSTRAINT "InternalThreadMember_threadId_InternalThread_id_fkey" FOREIGN KEY ("threadId") REFERENCES "InternalThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "InternalThreadMember" ADD CONSTRAINT "InternalThreadMember_userId_User_id_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "InternalThread" ADD CONSTRAINT "InternalThread_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_Workspace_id_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeUserId_User_id_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeTeamId_InboxTeam_id_fkey" FOREIGN KEY ("assigneeTeamId") REFERENCES "InboxTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByUserId_User_id_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "Task" ADD CONSTRAINT "Task_threadId_InternalThread_id_fkey" FOREIGN KEY ("threadId") REFERENCES "InternalThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "TaskTarget" ADD CONSTRAINT "TaskTarget_taskId_Task_id_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "TaskTarget" ADD CONSTRAINT "TaskTarget_contactId_Contact_id_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "TaskTarget" ADD CONSTRAINT "TaskTarget_conversationId_Conversation_id_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "TaskWatcher" ADD CONSTRAINT "TaskWatcher_taskId_Task_id_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "TaskWatcher" ADD CONSTRAINT "TaskWatcher_userId_User_id_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;