import { listTags, renameTag } from '../src/lib/tags'

export default function Tags() {
  return { tags: listTags(), rename: renameTag }
}
