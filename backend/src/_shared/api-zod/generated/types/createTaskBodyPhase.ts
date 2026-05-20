export type CreateTaskBodyPhase =
  (typeof CreateTaskBodyPhase)[keyof typeof CreateTaskBodyPhase];

export const CreateTaskBodyPhase = {
  proposal: "proposal",
  progress: "progress",
  final: "final",
} as const;
