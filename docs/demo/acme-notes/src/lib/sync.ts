export function pendingChanges(): string[] {
  return []
}

export function mergeDeleted(local: string[], remote: string[]) {
  return local.filter(id => !remote.includes(id))
}
