import { expect, test } from 'bun:test'
import * as subject from './account'

test('account loads', () => {
  expect(subject).toBeDefined()
})
