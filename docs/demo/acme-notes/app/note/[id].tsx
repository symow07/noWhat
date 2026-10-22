import { openEditor } from '../../src/lib/editor'

export default function Note({ id }: { id: string }) {
  return openEditor(id)
}
