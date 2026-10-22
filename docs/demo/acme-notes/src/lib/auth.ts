export async function signUp(email: string) {
  return { email }
}

export async function sendMagicLink(email: string) {
  return { sent: email.includes('@') }
}
