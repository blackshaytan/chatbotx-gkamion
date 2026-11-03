CREATE TYPE "aiCallOptOutSource" AS ENUM('clientCall', 'clientChat', 'manager');--> statement-breakpoint
ALTER TABLE "Contact" ADD COLUMN "aiCallOptOutAt" timestamp(6) with time zone;--> statement-breakpoint
ALTER TABLE "Contact" ADD COLUMN "aiCallOptOutSource" "aiCallOptOutSource";--> statement-breakpoint
ALTER TABLE "Contact" ADD COLUMN "aiCallOptOutReason" text;--> statement-breakpoint