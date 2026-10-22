import { expect, test } from 'bun:test'
import * as subject from './settings'

test('settings loads', () => {
  expect(subject).toBeDefined()
})
