interface ScrollLockStyles {
  left: string
  overflow: string
  position: string
  top: string
  width: string
}

interface ScrollLockDocument {
  body: {
    style: ScrollLockStyles
  }
  documentElement: {
    style: Pick<ScrollLockStyles, 'overflow'>
  }
}

interface ScrollLockWindow {
  readonly scrollX: number
  readonly scrollY: number
  scrollTo(x: number, y: number): void
}

export function lockDocumentScroll(
  targetDocument: ScrollLockDocument = document,
  targetWindow: ScrollLockWindow = window,
): () => void {
  const { body, documentElement } = targetDocument
  const scrollX = targetWindow.scrollX
  const scrollY = targetWindow.scrollY
  const previousRootOverflow = documentElement.style.overflow
  const previousBodyStyles = {
    left: body.style.left,
    overflow: body.style.overflow,
    position: body.style.position,
    top: body.style.top,
    width: body.style.width,
  }

  documentElement.style.overflow = 'hidden'
  body.style.left = `-${scrollX}px`
  body.style.overflow = 'hidden'
  body.style.position = 'fixed'
  body.style.top = `-${scrollY}px`
  body.style.width = '100%'

  return () => {
    documentElement.style.overflow = previousRootOverflow
    body.style.left = previousBodyStyles.left
    body.style.overflow = previousBodyStyles.overflow
    body.style.position = previousBodyStyles.position
    body.style.top = previousBodyStyles.top
    body.style.width = previousBodyStyles.width
    targetWindow.scrollTo(scrollX, scrollY)
  }
}
