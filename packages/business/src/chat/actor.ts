import type { TaskActor } from "../task/actor"

export type ChatActor =
  | { kind: "user"; userId: string }
  | { kind: "api"; label: string }
export type ChatScope =
  | { kind: "member"; userId: string }
  | { kind: "workspace" }
export const actorParticipantUserId = (actor: ChatActor): string | null =>
  actor.kind === "user" ? actor.userId : null
export const toTaskActor = (actor: ChatActor): TaskActor =>
  actor.kind === "user" ? { ...actor, isOwner: false } : actor
