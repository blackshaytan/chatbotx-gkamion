export const extractApiErrorMessage = (
  error: unknown,
  fallback: string,
): string => {
  if (error && typeof error === "object" && "data" in error) {
    const issues = (error as { data?: { issues?: { message?: string }[] } })
      .data?.issues
    const issueMessage = issues?.find((issue) => issue.message)?.message

    if (issueMessage) {
      return issueMessage
    }
  }

  return error instanceof Error ? error.message : fallback
}
