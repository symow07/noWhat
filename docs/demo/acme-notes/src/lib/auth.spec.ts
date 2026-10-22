import { expect, test } from 'bun:test'
import * as subject from './auth'

test('auth loads', () => {
  expect(subject).toBeDefined()
})
