# vncache (very nice cache)

a library to manage state and caching for remote resources with a REST-like backend.

## getting started

```typescript
// cache.ts
import {resource, createResourceCache} from '@delashum/vncache'

type Task = {
  id: string
  name: string
  completed: boolean
}

const tasksResource = resource<Task>(async () => {
  const tasks = await fetchTasksFromBackend()
  return tasks
})

const $cache = createResourceCache({
  tasks: tasksResource,
})
```

```tsx
// App.tsx
import {$cache} from './cache.ts'

const App = () => {
  const tasks = $cache.tasks.use()

  return (
    <div>
      {tasks.map(t => (
        <div>{t.name}</div>
      ))}
    </div>
  )
}
```
