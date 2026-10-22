import { expect, test } from 'bun:test'
import * as subject from './sync'

test('sync loads', () => {
  expect(subject).toBeDefined()
})
