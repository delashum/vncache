import {act, renderHook} from '@testing-library/react-hooks'
import {useState} from 'react'

import {createResourceCache} from '../src'
import {MOCK_FNS, MOCK_RESOURCES} from './helpers/mocks'
import {sleep} from './helpers/utils'

describe('use', () => {
  it('works', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES)
    const {result, waitForNextUpdate} = renderHook(() => $cache.a.use())
    await waitForNextUpdate()
    expect(result.current).toHaveLength(3)
  })
  it('updates live', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES)
    const {result, waitForNextUpdate} = renderHook(() => $cache.b.use())
    await waitForNextUpdate()
    expect(result.current).toHaveLength(5)
    $cache.b.do('addB', {id: 'b6', value: 6})
    await waitForNextUpdate()
    expect(result.current).toHaveLength(6)
    expect(MOCK_FNS.b.fetch).toHaveBeenCalledTimes(1)
  })
  it('listens to id changes', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES)
    const {result, waitForNextUpdate} = renderHook(() => {
      const [id, setId] = useState('a1')
      const as = $cache.a.ids(id).use()
      return {as, setId}
    })
    await waitForNextUpdate()
    expect(result.current.as).toHaveLength(1)
    expect(result.current.as[0].id).toEqual('a1')
    act(() => {
      result.current.setId('a2')
    })
    expect(result.current.as).toHaveLength(1)
    expect(result.current.as[0].id).toEqual('a2')
  })
  it('embedded resources are live', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES)
    const {result, waitForNextUpdate} = renderHook(() => $cache.a.fetch('oneA').use())
    await waitForNextUpdate()
    expect(result.current.myA).toBeDefined()
    expect(result.current.myA.id).toEqual('a1')
    expect(result.current.myA.b_id).toEqual('b1')

    await act(async () => {
      await $cache.a.do('updateA1', null)
    })

    expect(result.current.myA).toBeDefined()
    expect(result.current.myA.id).toEqual('a1')
    expect(result.current.myA.b_id).toEqual('b2')
  })
  it('event updates work with hooks', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES, {eventDebounce: 50, cacheTimeout: 100})
    const hook1 = renderHook(() => $cache.c.use())
    await hook1.waitForNextUpdate()
    expect(hook1.result.current).toHaveLength(2)
    await act(async () => {
      $cache.c.fetch('embeddedC').resolve()
      await sleep(500)
    })
    const {result: result2, waitForNextUpdate: wait2} = renderHook(() => $cache.c.use())
    wait2()
    expect(result2.current).toHaveLength(2)
    expect(MOCK_FNS.c.fetch).toHaveBeenCalledTimes(1)
  })
  xit('handles errors', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES)
    const {result, waitForNextUpdate, rerender} = renderHook(
      ({error}: {error: boolean}) => $cache.b.query({error}).use(),
      {initialProps: {error: false}}
    )
    await waitForNextUpdate()
    expect(result.current.error).toBeNull()
    rerender({error: true})
    await waitForNextUpdate()
    expect(result.error).toEqual('ERROR: errorB')
    expect(MOCK_FNS.b.fetch).toHaveBeenCalledTimes(2)
  })
})
