/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

// Helpers for the comma-separated "added"/"failed" item accumulators used by the wifi and proxy
// state machines. They keep the lists deduplicated and mutually exclusive so a re-attempt (e.g.
// "already exists") can't list the same item as both added and failed, or list it twice.

const split = (list?: string | null): string[] => (list ? list.split(', ').filter((s) => s.length > 0) : [])

/** Appends name to a comma-separated list, skipping empty names and duplicates. */
export function addUnique(list: string | undefined, name?: string | null): string | undefined {
  if (name == null || name === '') {
    return list
  }
  const items = split(list)
  if (items.includes(name)) {
    return list
  }
  items.push(name)
  return items.join(', ')
}

/** Removes name from a comma-separated list, returning undefined when the list becomes empty. */
export function removeItem(list: string | undefined, name?: string | null): string | undefined {
  if (name == null || name === '' || list == null) {
    return list
  }
  const items = split(list).filter((n) => n !== name)
  return items.length > 0 ? items.join(', ') : undefined
}

/** Records a failed item, but not if it already succeeded (present in `added`); deduplicated. */
export function addFailure(
  failed: string | undefined,
  added: string | undefined,
  name?: string | null
): string | undefined {
  if (name == null || name === '' || split(added).includes(name)) {
    return failed
  }
  return addUnique(failed, name)
}
