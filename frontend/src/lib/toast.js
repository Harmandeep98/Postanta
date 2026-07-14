let toasts = []
let listeners = []

function emit() {
  listeners.forEach((fn) => fn(toasts))
}

export function subscribeToasts(fn) {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter((l) => l !== fn)
  }
}

export function getToasts() {
  return toasts
}

export function dismissToast(id) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

// ponytail: Date.now()/counter for id is fine here — toasts are ephemeral UI, not persisted
let nextId = 1

export function pushToast(message, type = 'error') {
  const id = nextId++
  toasts = [...toasts, { id, message, type }]
  emit()
  setTimeout(() => dismissToast(id), 5000)
}
