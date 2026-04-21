import { useEffect, useRef } from 'react'

const MAX_PAE = 31.75

function paeToColor(pae) {
  const t = Math.min(pae / MAX_PAE, 1)
  return [
    Math.round(255 * t),
    Math.round(180 + 75 * t),
    Math.round(255 * t),
  ]
}

export default function PaeHeatmap({ pae, chainBorders, showChainBorders }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!pae || !canvasRef.current) return
    const n = pae.length
    const canvas = canvasRef.current
    canvas.width = n
    canvas.height = n
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(n, n)

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const [r, g, b] = paeToColor(pae[i][j])
        const idx = (i * n + j) * 4
        img.data[idx] = r
        img.data[idx + 1] = g
        img.data[idx + 2] = b
        img.data[idx + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)

    if (showChainBorders && chainBorders) {
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'
      ctx.lineWidth = 1
      for (const pos of chainBorders) {
        ctx.beginPath()
        ctx.moveTo(pos, 0)
        ctx.lineTo(pos, n)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(0, pos)
        ctx.lineTo(n, pos)
        ctx.stroke()
      }
    }
  }, [pae, chainBorders, showChainBorders])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }}
    />
  )
}
