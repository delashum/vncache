import {createResourceCache} from '..'
import {MOCK_FNS, MOCK_RESOURCES} from './mocks'

describe('batch', () => {
  it('batching works with multiple resources', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES)
    const [resA, resB] = await $cache.batch($cache.a, $cache.b).resolve()
    expect(MOCK_FNS.a.fetch).toHaveBeenCalledTimes(1)
    expect(MOCK_FNS.b.fetch).toHaveBeenCalledTimes(1)
    expect(resA).toHaveLength(3)
    expect(resB).toHaveLength(5)
  })
  it('batching works with mixed types', async () => {
    const $cache = createResourceCache(MOCK_RESOURCES)
    const [resA, resB] = await $cache.batch($cache.a, $cache.a.fetch('aSum')).resolve()
    expect(MOCK_FNS.a.fetch).toHaveBeenCalledTimes(1)
    expect(MOCK_FNS.a.sumRequest).toHaveBeenCalledTimes(1)
    expect(resA).toHaveLength(3)
    expect(resB).toEqual(100)
  })
})
