import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export class GraphicsBrowser {
  #socket
  #pending = new Map()
  #id = 0
  events = []

  static async connect(port) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`)
    if (!response.ok) throw new Error(`CDP target discovery failed: ${response.status}`)
    const target = (await response.json()).find((entry) => entry.type === 'page')
    if (!target) throw new Error('The dedicated graphics browser has no page')
    const browser = new GraphicsBrowser()
    browser.#socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      browser.#socket.addEventListener('open', resolve, { once: true })
      browser.#socket.addEventListener('error', reject, { once: true })
    })
    browser.#socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      if (!message.id) {
        if (['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded', 'Network.requestWillBeSent'].includes(message.method)) {
          if (browser.events.length < 2000) browser.events.push(message)
        }
        return
      }
      const request = browser.#pending.get(message.id)
      if (!request) return
      browser.#pending.delete(message.id)
      clearTimeout(request.timeout)
      if (message.error) request.reject(new Error(`${request.method}: ${JSON.stringify(message.error)}`))
      else request.resolve(message.result)
    })
    browser.#socket.addEventListener('close', () => {
      for (const request of browser.#pending.values()) {
        clearTimeout(request.timeout)
        request.reject(new Error(`CDP disconnected during ${request.method}`))
      }
      browser.#pending.clear()
    })
    for (const method of ['Runtime.enable', 'Page.enable', 'Log.enable', 'Network.enable']) await browser.send(method)
    await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    return browser
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.#id
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`CDP timeout after ${timeoutMs} ms: ${method}`))
      }, timeoutMs)
      this.#pending.set(id, { method, resolve, reject, timeout })
      this.#socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression, timeoutMs = 30000) {
    const result = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true,
    }, timeoutMs)
    if (result.exceptionDetails) throw new Error(`Page evaluation failed: ${JSON.stringify(result.exceptionDetails)}`)
    return result.result.value
  }

  async waitFor(expression, timeoutMs = 30000) {
    const deadline = performance.now() + timeoutMs
    while (performance.now() < deadline) {
      if (await this.evaluate(expression)) return
      const exception = this.events.find((event) => event.method === 'Runtime.exceptionThrown')
      if (exception) throw new Error(`Browser exception: ${JSON.stringify(exception.params)}`)
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${expression}; ${JSON.stringify(this.events.slice(-5))}`)
  }

  async clickSelector(selector) {
    const point = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled) throw new Error('Missing/disabled control: ' + ${JSON.stringify(selector)});
      element.scrollIntoView({block:'center'});
      const rect = element.getBoundingClientRect();
      return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
    })()`)
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  }

  async type(selector, text) {
    await this.clickSelector(selector)
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
    await this.send('Input.insertText', { text })
  }

  async key(code, down) {
    const special = { ShiftLeft: ['Shift', 16], Space: [' ', 32], Escape: ['Escape', 27] }
    const [key, virtual] = special[code] ?? [code.replace(/^Key/, '').toLowerCase(), code.replace(/^Key/, '').charCodeAt(0)]
    await this.send('Input.dispatchKeyEvent', {
      type: down ? 'keyDown' : 'keyUp', key, code, windowsVirtualKeyCode: virtual,
    })
  }

  async screenshot(path) {
    const shot = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    await mkdir(dirname(path), { recursive: true })
    const bytes = Buffer.from(shot.data, 'base64')
    await writeFile(path, bytes)
    return bytes
  }

  close() { this.#socket.close() }
}
