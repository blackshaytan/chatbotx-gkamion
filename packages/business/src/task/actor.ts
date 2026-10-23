/** Who performs a task or feed action. API tokens and flows act with workspace authority. */
export type TaskActor =
  | { kind: "user"; userId: string; isOwner: boolean }
  | { kind: "api"; label: string }
  | { kind: "flow"; label: string }

export const actorUserId = (actor: TaskActor): string | null =>
  actor.kind === "user" ? actor.userId : null

export const actorLabel = (actor: TaskActor): string | null =>
  actor.kind === "user" ? null : actor.label
