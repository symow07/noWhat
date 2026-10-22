import Purchases from 'react-native-purchases'

export function setUpBilling() {
  Purchases.configure({ apiKey: 'public-sdk-key-goes-here' })
}

export async function buyPro() {
  return Purchases.getOfferings()
}

export async function restore() {
  return Purchases.restorePurchases()
}
