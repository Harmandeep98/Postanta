// Shared onMutate/onError pair for optimistically updating a cached list query.
// `updater(old, variables)` returns the new list immediately; on failure the
// snapshot taken before the mutation is restored, then onSettled (caller-provided)
// should invalidate to reconcile with the server either way.
export function optimisticList(queryClient, queryKey, updater) {
  return {
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData(queryKey)
      queryClient.setQueryData(queryKey, (old) => updater(old, variables))
      return { previous }
    },
    onError: (err, variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous)
    },
  }
}
