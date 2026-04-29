const POLAR_ELEMENTS = new Set(['N', 'O', 'S'])
const HBOND_DISTANCE_CUTOFF = 3.5

function parsePdbLine(line) {
  const recordType = line.substring(0, 6).trim()
  if (recordType !== 'ATOM' && recordType !== 'HETATM') return null
  return {
    recordType,
    serial: parseInt(line.substring(6, 11)),
    atomName: line.substring(12, 16).trim(),
    resName: line.substring(17, 20).trim(),
    chain: line.substring(21, 22).trim(),
    resSeq: parseInt(line.substring(22, 26)),
    x: parseFloat(line.substring(30, 38)),
    y: parseFloat(line.substring(38, 46)),
    z: parseFloat(line.substring(46, 54)),
    element: line.substring(76, 78).trim(),
  }
}

function distance(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

export async function analyzeInteractions(pdbUrl) {
  const text = await fetch(pdbUrl).then(r => r.text())
  const lines = text.split('\n')

  const proteinAtoms = []
  const ligandAtoms = []

  for (const line of lines) {
    const atom = parsePdbLine(line)
    if (!atom || !atom.element) continue
    if (atom.recordType === 'HETATM') {
      ligandAtoms.push(atom)
    } else {
      proteinAtoms.push(atom)
    }
  }

  const ligandPolar = ligandAtoms.filter(a => POLAR_ELEMENTS.has(a.element))
  const proteinPolar = proteinAtoms.filter(a => POLAR_ELEMENTS.has(a.element))

  const hBonds = []

  for (const la of ligandPolar) {
    for (const pa of proteinPolar) {
      const dist = distance(la, pa)
      if (dist > HBOND_DISTANCE_CUTOFF) continue
      hBonds.push({
        donorChain: la.chain,
        donorPosition: la.resSeq,
        donorResidue: la.resName,
        donorAtom: la.atomName,
        acceptorChain: pa.chain,
        acceptorPosition: pa.resSeq,
        acceptorResidue: pa.resName,
        acceptorAtom: pa.atomName,
        distance: Math.round(dist * 1000) / 1000,
      })
    }
  }

  hBonds.sort((a, b) => a.distance - b.distance)

  return { hBonds }
}
