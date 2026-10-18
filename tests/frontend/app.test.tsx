// @vitest-environment jsdom
/**
 * The real App, rendered in jsdom, talking over HTTP to a real MIRA server with an in-memory SQLite database.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../../src/App'
import { configureApi } from '../../src/mira/api'
import { startServer, type TestServer } from '../api/testServer'

let s: TestServer
beforeEach(async () => {
  s = await startServer({ seed: true, now: () => new Date(), timeZone: null })
  configureApi({ baseUrl: `${s.base}/api` })
})
afterEach(async () => {
  cleanup()
  await s.close()
})

/** The task row (Today / Tasks lists) for a title: the element that holds both the title and its checkbox. */
function row(title: string) {
  const found = screen.getAllByText(title).map((el) => el.parentElement?.parentElement).find((r) => r?.querySelector('button[aria-label^="Mark"]'))
  if (!found) throw new Error(`No task row for ${title}`)
  return found as HTMLElement
}
const serverTasks = async () => (await s.call('GET', '/tasks')).body.tasks as any[]
const nav = (label: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))

describe('MIRA frontend against the real API', () => {
  it('loads tasks and preferences from the backend', async () => {
    render(<App />)
    expect(await screen.findByText('Loading your tasks…')).toBeTruthy()
    expect(await screen.findAllByText('Computer Networks Assignment')).not.toHaveLength(0)
    expect(screen.getByText('Welcome, Mr. Rathi.')).toBeTruthy()
    expect(screen.getAllByText('Mr. Rathi').length).toBeGreaterThan(0)
    // Six open demo tasks in the sidebar count, one completed today.
    expect(within(screen.getByRole('button', { name: /^Tasks/ })).getByText('6')).toBeTruthy()
  })

  it('persists a task created with Quick Add', async () => {
    render(<App />)
    await screen.findAllByText('Computer Networks Assignment')
    fireEvent.keyDown(window, { code: 'Space', ctrlKey: true })
    const input = await screen.findByPlaceholderText('Complete CN assignment by 10 Oct')
    fireEvent.change(input, { target: { value: 'Write thesis outline by tomorrow' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('Added to MIRA.')).toBeTruthy()
    expect(screen.getAllByText('Write thesis outline').length).toBeGreaterThan(0)
    const saved = (await serverTasks()).find((t) => t.title === 'Write thesis outline')
    expect(saved).toBeTruthy()
    expect(saved.computed.status).not.toBe('Completed')
  })

  it('completes a task and updates every view from the stored result', async () => {
    render(<App />)
    await screen.findAllByText('DBMS Mini Project')
    const r = row('DBMS Mini Project')
    fireEvent.click(within(r).getByRole('button', { name: 'Mark complete' }))

    expect(await screen.findByText('One less thing.')).toBeTruthy()
    await waitFor(() => expect(within(row('DBMS Mini Project')).getByRole('button', { name: 'Mark incomplete' })).toBeTruthy())
    expect((await serverTasks()).find((t) => t.title === 'DBMS Mini Project').completed).toBe(true)
    expect(within(screen.getByRole('button', { name: /^Tasks/ })).getByText('5')).toBeTruthy()

    const main = () => within(screen.getByRole('main'))
    nav('Completed')
    expect(await main().findByText('DBMS Mini Project')).toBeTruthy()
    nav('Tasks')
    await main().findByText('Computer Networks Assignment')
    expect(main().queryByText('DBMS Mini Project')).toBeNull()
  })

  it('keeps tasks and preferences after a refresh', async () => {
    const first = render(<App />)
    await screen.findAllByText('Computer Networks Assignment')
    nav('Settings')
    fireEvent.change(await screen.findByDisplayValue('Mr. Rathi'), { target: { value: 'Jai' } })
    await waitFor(async () => expect((await s.call('GET', '/preferences')).body.preferences.displayName).toBe('Jai'), { timeout: 3000 })
    first.unmount()

    render(<App />)
    expect(await screen.findByText('Welcome, Jai.')).toBeTruthy()
    expect(screen.getAllByText('Jai').length).toBeGreaterThan(0)
  })

  it('shows an honest offline state when the server cannot be reached', async () => {
    const dead = await startServer()
    const deadBase = dead.base
    await dead.close()
    configureApi({ baseUrl: `${deadBase}/api` })
    render(<App />)
    expect(await screen.findByText("Can't reach MIRA's local server.")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.queryByText('Computer Networks Assignment')).toBeNull()
  })

  it('reports a failed change instead of pretending it worked', async () => {
    render(<App />)
    await screen.findAllByText('Computer Networks Assignment')
    // The task disappears behind the UI's back, then the user tries to complete it.
    const cn = (await serverTasks()).find((t) => t.title === 'Computer Networks Assignment')
    await s.call('DELETE', `/tasks/${cn.id}`)
    fireEvent.click(within(row('Computer Networks Assignment')).getByRole('button', { name: 'Mark complete' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Task not found.'))
    expect(within(row('Computer Networks Assignment')).getByRole('button', { name: 'Mark complete' })).toBeTruthy()
    expect(screen.queryByText('One less thing.')).toBeNull()
  })

  it('reports a server that goes away mid-session', async () => {
    render(<App />)
    await screen.findAllByText('Physics Problem Set 4')
    await s.close()
    fireEvent.click(within(row('Physics Problem Set 4')).getByRole('button', { name: 'Mark complete' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining("Can't reach MIRA's local server."))
    expect(within(row('Physics Problem Set 4')).getByRole('button', { name: 'Mark complete' })).toBeTruthy()
    s = await startServer() // so afterEach has something to close
  })
})
