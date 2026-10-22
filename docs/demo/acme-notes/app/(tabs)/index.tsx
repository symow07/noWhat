import { listNotes } from '../../src/lib/notes'
import { rebuildIndex } from '../../src/lib/search'

export default function NotesList() {
  const notes = listNotes()
  return { titles: notes.map(note => note.title), reindex: rebuildIndex }
}
