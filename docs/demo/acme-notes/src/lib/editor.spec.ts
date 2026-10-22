import { expect, test } from 'bun:test'
import * as subject from './editor'

test('editor loads', () => {
  expect(subject).toBeDefined()
})
