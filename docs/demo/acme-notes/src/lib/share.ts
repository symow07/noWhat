const signingKey = process.env.SHARE_SIGNING_KEY

export function openSharedNote(token: string) {
  return { token, signed: signingKey !== undefined }
}
