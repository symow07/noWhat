import { buyPro, restore } from '../src/lib/billing'

export default function Paywall() {
  return { buy: buyPro, restore }
}
