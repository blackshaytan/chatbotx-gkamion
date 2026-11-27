ALTER TABLE "Inbox" ADD COLUMN "ownerUserId" bigint;--> statement-breakpoint
CREATE INDEX "Inbox_workspaceId_ownerUserId_idx" ON "Inbox" ("workspaceId","ownerUserId");--> statement-breakpoint
ALTER TABLE "Inbox" ADD CONSTRAINT "Inbox_ownerUserId_User_id_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;