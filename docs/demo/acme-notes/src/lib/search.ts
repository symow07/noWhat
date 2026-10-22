import { listNotes } from './notes'

// FIXME: the index rebuild holds every note in memory
export function rebuildIndex() {
  return listNotes().map(note => note.title.toLowerCase())
}
