export async function request<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: data === undefined ? {} : { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data), credentials: 'same-origin' })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Не удалось выполнить запрос')
  return result as T
}
