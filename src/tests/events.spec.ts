import {act, renderHook} from '@testing-library/react-hooks'

import {createResourceCache} from '..'
import {MOCK_RESOURCES, TypeB} from './mocks'

describe('events', () => {
  it('inserts new resource to empty cache', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES)
    const {result, waitForNextUpdate} = renderHook(() => $cache.b.query({returnEmpty: true}).use())
    await waitForNextUpdate()
    expect(result.current).toHaveLength(0)
    const newB: TypeB = {id: 'new', value: 1}
    await act(async () => {
      $cache.publish({name: 'b.created', payload: newB}, false)
      await waitForNextUpdate()
    })
    expect(result.current).toHaveLength(1)
    const newB1: TypeB = {id: 'new2', value: 2}
    await act(async () => {
      $cache.publish({name: 'b.created', payload: newB1}, false)
      await waitForNextUpdate()
    })
    expect(result.current).toHaveLength(2)
  })
  it('inserts new resource to list all cache', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES)
    const p1 = $cache.b.ids('b1').resolve()
    const p2 = $cache.b.resolve()
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toHaveLength(1)
    expect(r2.length).toBeGreaterThan(1)
    const newB1: TypeB = {id: 'new2', value: 2}
    $cache.publish({name: 'b.created', payload: newB1}, false)
    const r3 = await $cache.b.resolve()
    expect(r3).toHaveLength(6)
  })
  it('update request body from request watcher', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES)
    const fetcher = $cache.d.fetch('randomData')
    const d1 = await fetcher.resolve()
    expect(d1).toEqual({one: 1, two: 2, three: 3})
    $cache.publish({name: 'randomData.squared'}, false)
    const d2 = await fetcher.resolve()
    expect(d2).toEqual({one: 1, two: 4, three: 9})
  })
})
