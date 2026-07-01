/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { addUnique, removeItem, addFailure } from './statusList.js'

describe('statusList', () => {
  describe('addUnique', () => {
    it('appends to an empty list', () => {
      expect(addUnique(undefined, 'P1')).toEqual('P1')
    })
    it('appends a new item', () => {
      expect(addUnique('P1', 'P2')).toEqual('P1, P2')
    })
    it('does not append a duplicate', () => {
      expect(addUnique('P1, P2', 'P2')).toEqual('P1, P2')
    })
    it('ignores empty/null names', () => {
      expect(addUnique('P1', '')).toEqual('P1')
      expect(addUnique('P1', null)).toEqual('P1')
    })
  })

  describe('removeItem', () => {
    it('removes an item', () => {
      expect(removeItem('P1, P2, P3', 'P2')).toEqual('P1, P3')
    })
    it('returns undefined when the list becomes empty', () => {
      expect(removeItem('P1', 'P1')).toBeUndefined()
    })
    it('is a no-op when the item is absent or list is empty', () => {
      expect(removeItem('P1, P2', 'P9')).toEqual('P1, P2')
      expect(removeItem(undefined, 'P1')).toBeUndefined()
    })
  })

  describe('addFailure', () => {
    it('appends a genuinely failed item', () => {
      expect(addFailure('P5', undefined, 'P6')).toEqual('P5, P6')
    })
    it('does not mark a failure for an item that already succeeded', () => {
      expect(addFailure(undefined, 'P1, P2', 'P1')).toBeUndefined()
      expect(addFailure('P5', 'P1, P2', 'P2')).toEqual('P5')
    })
    it('deduplicates repeated failures', () => {
      expect(addFailure('P5', undefined, 'P5')).toEqual('P5')
    })
  })
})
