import { deleteAccount } from '../../src/lib/account'

export default function DeleteAccount() {
  return { confirm: () => deleteAccount() }
}
