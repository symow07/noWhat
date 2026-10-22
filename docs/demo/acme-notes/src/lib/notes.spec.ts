import { expect, test } from 'bun:test'
import * as subject from './notes'

test('notes loads', () => {
  expect(subject).toBeDefined()
})
