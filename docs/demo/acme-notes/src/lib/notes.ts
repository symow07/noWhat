import { pendingChanges } from './sync'

export type Note = { id: string; title: string; body: string }

export function listNotes(): Note[] {
  return pendingChanges().length > 0 ? [] : []
}
