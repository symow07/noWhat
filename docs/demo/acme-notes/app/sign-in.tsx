import { sendMagicLink } from '../src/lib/auth'

export default function SignIn() {
  return { onSubmit: (email: string) => sendMagicLink(email) }
}
