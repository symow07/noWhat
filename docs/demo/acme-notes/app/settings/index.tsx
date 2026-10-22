import { loadSettings } from '../../src/lib/settings'

export const PRIVACY_URL = 'https://acme-notes.example/privacy'

export default function Settings() {
  return loadSettings()
}
