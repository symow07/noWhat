import { openSharedNote } from '../../src/lib/share'

export default function Shared({ token }: { token: string }) {
  return openSharedNote(token)
}
