// TODO: renaming a tag that notes use still loses the notes' links
export function listTags(): string[] {
  return []
}

export function renameTag(from: string, to: string) {
  return { from: from.toLowerCase(), to: to.toLowerCase() }
}
