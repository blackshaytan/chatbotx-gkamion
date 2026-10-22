ALTER TABLE "Conversation" ADD COLUMN "managerJoinedAt" timestamp(6) with time zone;--> statement-breakpoint
ALTER TABLE "ExternalAgent" ADD COLUMN "botName" text;--> statement-breakpoint
ALTER TABLE "ExternalAgent" ADD COLUMN "signMessages" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ExternalAgent" ADD COLUMN "announceManager" boolean DEFAULT false NOT NULL;