import { useRef, useState, useEffect, useCallback, useMemo } from 'react'

const MARGIN = { top: 10, right: 20, bottom: 60, left: 60 }
const MIN_DRAG_PX = 4

function paeToRgb(v) {
  const clamped = Math.max(0, Math.min(30, v))
  if (clamped <= 15) {
    const t = clamped / 15
    return [Math.round(t * 144), Math.round(100 + t * 138), Math.round(t * 144)]
  }
  const t = (clamped - 15) / 15
  return [Math.round(144 + t * 111), Math.round(238 + t * 17), Math.round(144 + t * 111)]
}

function generateTicks(matrixSize, count = 6) {
  if (matrixSize <= 1) return [1]
  const ticks = []
  const interval = (matrixSize - 1) / (count - 1)
  for (let i = 0; i < count; i++) {
    ticks.push(Math.round(1 + i * interval))
  }
  return ticks
}

function getChainBoundaries(tokenChainIds) {
  const boundaries = []
  for (let i = 1; i < tokenChainIds.length; i++) {
    if (tokenChainIds[i] !== tokenChainIds[i - 1]) boundaries.push(i)
  }
  return boundaries
}

function pxRangeToTokenRange(left, right, cellSize, matrixSize) {
  if (right - left < cellSize) return null
  const iMin = Math.ceil(left / cellSize - 0.5)
  const iMax = Math.floor(right / cellSize - 0.5)
  if (iMin > iMax) return null
  return [Math.max(0, Math.min(matrixSize - 1, iMin)), Math.max(0, Math.min(matrixSize - 1, iMax))]
}

export default function PAECanvas({ paeData, tokenChainIds = [], tokenResIds = [] }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const offscreenCanvasRef = useRef(null)
  const [canvasSize, setCanvasSize] = useState(400)
  const [showChainBorders, setShowChainBorders] = useState(true)
  const [hoverInfo, setHoverInfo] = useState(null)
  const [selectionRect, setSelectionRect] = useState(null)

  const isDraggingRef = useRef(false)
  const dragStartRef = useRef(null)
  const dragCurrentRef = useRef(null)

  const matrixSize = paeData?.length ?? 0
  const heatmapSize = canvasSize - MARGIN.left - MARGIN.right
  const cellSize = matrixSize > 0 ? heatmapSize / matrixSize : 1

  const heatmapImageData = useMemo(() => {
    if (matrixSize === 0) return null
    const imageData = new ImageData(matrixSize, matrixSize)
    const data = imageData.data
    for (let y = 0; y < matrixSize; y++) {
      const row = paeData[y]
      for (let x = 0; x < matrixSize; x++) {
        const idx = (y * matrixSize + x) * 4
        const [r, g, b] = paeToRgb(row[x])
        data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255
      }
    }
    return imageData
  }, [paeData, matrixSize])

  useEffect(() => {
    if (!heatmapImageData) { offscreenCanvasRef.current = null; return }
    const offscreen = document.createElement('canvas')
    offscreen.width = matrixSize
    offscreen.height = matrixSize
    offscreen.getContext('2d').putImageData(heatmapImageData, 0, 0)
    offscreenCanvasRef.current = offscreen
  }, [heatmapImageData, matrixSize])

  const chainBoundaries = useMemo(
    () => showChainBorders ? getChainBoundaries(tokenChainIds) : [],
    [tokenChainIds, showChainBorders]
  )

  const ticks = useMemo(() => generateTicks(matrixSize), [matrixSize])

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width
        setCanvasSize(Math.max(280, Math.floor(width)))
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const clientToHeatmapPx = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      hx: Math.max(0, Math.min(heatmapSize, clientX - rect.left - MARGIN.left)),
      hy: Math.max(0, Math.min(heatmapSize, clientY - rect.top - MARGIN.top)),
    }
  }, [heatmapSize])

  const clientToCell = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const cx = clientX - rect.left - MARGIN.left
    const cy = clientY - rect.top - MARGIN.top
    const mx = Math.floor(cx / cellSize)
    const my = Math.floor(cy / cellSize)
    if (mx < 0 || mx >= matrixSize || my < 0 || my >= matrixSize) return null
    return { mx, my }
  }, [cellSize, matrixSize])

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !heatmapImageData) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = canvasSize * dpr
    canvas.height = canvasSize * dpr
    canvas.style.width = `${canvasSize}px`
    canvas.style.height = `${canvasSize}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvasSize, canvasSize)

    const hmL = MARGIN.left, hmT = MARGIN.top

    ctx.imageSmoothingEnabled = false
    if (offscreenCanvasRef.current) {
      ctx.drawImage(offscreenCanvasRef.current, hmL, hmT, heatmapSize, heatmapSize)
    }

    if (chainBoundaries.length > 0) {
      ctx.strokeStyle = 'black'
      ctx.lineWidth = 1.5
      for (const pos of chainBoundaries) {
        const px = hmL + pos * cellSize
        const py = hmT + pos * cellSize
        ctx.beginPath(); ctx.moveTo(px, hmT); ctx.lineTo(px, hmT + heatmapSize); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(hmL, py); ctx.lineTo(hmL + heatmapSize, py); ctx.stroke()
      }
    }

    if (selectionRect) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 2
      const { x1, y1, x2, y2 } = selectionRect
      ctx.strokeRect(hmL + x1, hmT + y1, x2 - x1, y2 - y1)
    }

    if (isDraggingRef.current && dragStartRef.current && dragCurrentRef.current) {
      const ds = dragStartRef.current, dc = dragCurrentRef.current
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 4])
      ctx.strokeRect(hmL + Math.min(ds.hx, dc.hx), hmT + Math.min(ds.hy, dc.hy),
        Math.abs(dc.hx - ds.hx), Math.abs(dc.hy - ds.hy))
      ctx.setLineDash([])
    }

    ctx.fillStyle = '#aaa'
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    for (const t of ticks) ctx.fillText(String(t), hmL + (t - 0.5) * cellSize, hmT + heatmapSize + 4)

    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    for (const t of ticks) ctx.fillText(String(t), hmL - 6, hmT + (t - 0.5) * cellSize)

    ctx.font = '12px system-ui, sans-serif'
    ctx.fillStyle = '#aaa'
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    ctx.fillText('Scored Residue', hmL + heatmapSize / 2, hmT + heatmapSize + 22)

    ctx.save()
    ctx.translate(14, hmT + heatmapSize / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('Aligned Residue', 0, 0)
    ctx.restore()

    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.lineWidth = 1
    ctx.strokeRect(hmL, hmT, heatmapSize, heatmapSize)
  }, [canvasSize, heatmapImageData, heatmapSize, cellSize, chainBoundaries, ticks, selectionRect])

  useEffect(() => { renderCanvas() }, [renderCanvas])

  const handleMouseDown = useCallback((e) => {
    const hp = clientToHeatmapPx(e.clientX, e.clientY)
    if (!hp) return
    isDraggingRef.current = false
    dragStartRef.current = { hx: hp.hx, hy: hp.hy, px: e.clientX, py: e.clientY }
    dragCurrentRef.current = null
  }, [clientToHeatmapPx])

  const handleMouseMove = useCallback((e) => {
    const cell = clientToCell(e.clientX, e.clientY)
    if (cell) {
      setHoverInfo({ scored: cell.mx + 1, aligned: cell.my + 1, pae: paeData[cell.my]?.[cell.mx] ?? 0, clientX: e.clientX, clientY: e.clientY })
    } else {
      setHoverInfo(null)
    }
    if (dragStartRef.current) {
      const ds = dragStartRef.current
      if (Math.abs(e.clientX - ds.px) > MIN_DRAG_PX || Math.abs(e.clientY - ds.py) > MIN_DRAG_PX) {
        isDraggingRef.current = true
        const hp = clientToHeatmapPx(e.clientX, e.clientY)
        if (hp) { dragCurrentRef.current = hp; renderCanvas() }
      }
    }
  }, [clientToCell, clientToHeatmapPx, paeData, renderCanvas])

  const handleMouseUp = useCallback(() => {
    if (isDraggingRef.current && dragStartRef.current && dragCurrentRef.current) {
      const ds = dragStartRef.current, dc = dragCurrentRef.current
      const xLeft = Math.min(ds.hx, dc.hx), xRight = Math.max(ds.hx, dc.hx)
      const yTop = Math.min(ds.hy, dc.hy), yBottom = Math.max(ds.hy, dc.hy)
      const scoredRange = pxRangeToTokenRange(xLeft, xRight, cellSize, matrixSize)
      const alignedRange = pxRangeToTokenRange(yTop, yBottom, cellSize, matrixSize)
      if (scoredRange || alignedRange) {
        setSelectionRect({ x1: xLeft, y1: yTop, x2: xRight, y2: yBottom })
      } else {
        setSelectionRect(null)
      }
    } else {
      setSelectionRect(null)
    }
    isDraggingRef.current = false
    dragStartRef.current = null
    dragCurrentRef.current = null
  }, [cellSize, matrixSize])

  const handleMouseLeave = useCallback(() => {
    setHoverInfo(null)
    if (isDraggingRef.current) {
      isDraggingRef.current = false
      dragStartRef.current = null
      dragCurrentRef.current = null
      renderCanvas()
    }
  }, [renderCanvas])

  return (
    <div className="pae-wrap">
      <div ref={containerRef} style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{ cursor: 'crosshair', display: 'block' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />
        {hoverInfo && !isDraggingRef.current && (
          <div className="pae-tooltip" style={{ left: hoverInfo.clientX + 12, top: hoverInfo.clientY - 40, position: 'fixed' }}>
            <div>Scored: {hoverInfo.scored}</div>
            <div>Aligned: {hoverInfo.aligned}</div>
            <div>PAE: {hoverInfo.pae.toFixed(2)} Å</div>
          </div>
        )}
      </div>

      {tokenChainIds.length > 0 && (
        <div className="pae-chain-toggle">
          <input
            type="checkbox"
            id="chain-borders"
            checked={showChainBorders}
            onChange={(e) => setShowChainBorders(e.target.checked)}
          />
          <label htmlFor="chain-borders">Display Chain Borders</label>
        </div>
      )}

      <div className="pae-legend">
        <div className="pae-legend-label">Scored Residue</div>
        <div className="pae-legend-bar" />
        <div className="pae-legend-ticks">
          {[0, 5, 10, 15, 20, 25, 30].map(v => <span key={v}>{v}</span>)}
        </div>
        <div className="pae-legend-unit">Expected Position Error (Å)</div>
      </div>
    </div>
  )
}
