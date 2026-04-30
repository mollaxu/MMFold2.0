const POLAR_ELEMENTS = new Set(['N', 'O', 'S'])
const HBOND_CUTOFF = 3.5
const PI_PI_CUTOFF = 6.5
const PI_CATION_CUTOFF = 6.0
const SALT_BRIDGE_CUTOFF = 4.0
const HYDROPHOBIC_CUTOFF = 4.5

// Aromatic ring atom names for protein residues
const PROTEIN_RINGS = {
  PHE: [['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2']],
  TYR: [['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2']],
  TRP: [
    ['CG', 'CD1', 'NE1', 'CE2', 'CD2'],
    ['CE2', 'CD2', 'CE3', 'CZ3', 'CH2', 'CZ2'],
  ],
  HIS: [['CG', 'ND1', 'CE1', 'NE2', 'CD2']],
}

// Cation atoms on protein residues
const CATION_ATOMS = {
  ARG: ['NH1', 'NH2', 'NE'],
  LYS: ['NZ'],
  HIS: ['ND1', 'NE2'],
}

// Anion atoms on protein residues
const ANION_ATOMS = {
  ASP: ['OD1', 'OD2'],
  GLU: ['OE1', 'OE2'],
}

const HYDROPHOBIC_RESIDUES = new Set(['ALA', 'VAL', 'LEU', 'ILE', 'PHE', 'TRP', 'MET', 'PRO'])

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

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function centroid(atoms) {
  const n = atoms.length
  let sx = 0, sy = 0, sz = 0
  for (const a of atoms) { sx += a.x; sy += a.y; sz += a.z }
  return { x: sx / n, y: sy / n, z: sz / n }
}

function cross(u, v) {
  return {
    x: u.y * v.z - u.z * v.y,
    y: u.z * v.x - u.x * v.z,
    z: u.x * v.y - u.y * v.x,
  }
}

function normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  if (len === 0) return { x: 0, y: 0, z: 0 }
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z }

// Normal vector of a ring (using first 3 atoms to define the plane)
function ringNormal(atoms) {
  if (atoms.length < 3) return { x: 0, y: 1, z: 0 }
  const u = { x: atoms[1].x - atoms[0].x, y: atoms[1].y - atoms[0].y, z: atoms[1].z - atoms[0].z }
  const v = { x: atoms[2].x - atoms[0].x, y: atoms[2].y - atoms[0].y, z: atoms[2].z - atoms[0].z }
  return normalize(cross(u, v))
}

// Angle between two ring normals in degrees (0-90 range)
function normalAngle(n1, n2) {
  const cosAngle = Math.abs(dot(n1, n2))
  return Math.acos(Math.min(1, cosAngle)) * (180 / Math.PI)
}

// Detect aromatic rings in ligand by finding cycles of sp2-like atoms
function detectLigandRings(atoms) {
  const candidates = atoms.filter(a => a.element === 'C' || a.element === 'N' || a.element === 'S')
  const bondCutoff = 1.9
  const adj = new Map()
  for (const a of candidates) {
    adj.set(a.serial, [])
  }
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (dist(candidates[i], candidates[j]) < bondCutoff) {
        adj.get(candidates[i].serial).push(candidates[j])
        adj.get(candidates[j].serial).push(candidates[i])
      }
    }
  }

  const found = []

  // Find 5- and 6-membered rings via DFS
  for (const start of candidates) {
    const dfs = (current, path, visited) => {
      if (path.length > 6) return
      for (const neighbor of (adj.get(current.serial) || [])) {
        if (neighbor.serial === start.serial && path.length >= 5) {
          found.push([...path])
          continue
        }
        if (visited.has(neighbor.serial)) continue
        visited.add(neighbor.serial)
        dfs(neighbor, [...path, neighbor], visited)
        visited.delete(neighbor.serial)
      }
    }
    const visited = new Set([start.serial])
    dfs(start, [start], visited)
  }

  // Deduplicate rings by sorted serial sets
  const rings = []
  const seen = new Set()
  for (const ring of found) {
    const key = ring.map(a => a.serial).sort((a, b) => a - b).join(',')
    if (seen.has(key)) continue
    seen.add(key)
    if (ring.length === 5 || ring.length === 6) {
      rings.push(ring)
    }
  }
  return rings
}

// Get protein aromatic rings from residue atoms
function getProteinRings(proteinAtoms) {
  const byResidue = new Map()
  for (const a of proteinAtoms) {
    const key = `${a.chain}:${a.resSeq}`
    if (!byResidue.has(key)) byResidue.set(key, [])
    byResidue.get(key).push(a)
  }

  const rings = []
  for (const [key, atoms] of byResidue) {
    const resName = atoms[0].resName
    const ringDefs = PROTEIN_RINGS[resName]
    if (!ringDefs) continue
    for (const def of ringDefs) {
      const ringAtoms = def.map(name => atoms.find(a => a.atomName === name)).filter(Boolean)
      if (ringAtoms.length >= def.length - 1) {
        rings.push({
          chain: atoms[0].chain,
          resSeq: atoms[0].resSeq,
          resName,
          atoms: ringAtoms,
        })
      }
    }
  }
  return rings
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

  // ── H-Bond ──
  const ligandPolar = ligandAtoms.filter(a => POLAR_ELEMENTS.has(a.element))
  const proteinPolar = proteinAtoms.filter(a => POLAR_ELEMENTS.has(a.element))
  const hBonds = []
  for (const la of ligandPolar) {
    for (const pa of proteinPolar) {
      const d = dist(la, pa)
      if (d > HBOND_CUTOFF) continue
      hBonds.push({
        donorChain: la.chain, donorPosition: la.resSeq,
        donorResidue: la.resName, donorAtom: la.atomName,
        acceptorChain: pa.chain, acceptorPosition: pa.resSeq,
        acceptorResidue: pa.resName, acceptorAtom: pa.atomName,
        distance: Math.round(d * 1000) / 1000,
      })
    }
  }
  hBonds.sort((a, b) => a.distance - b.distance)

  // ── π-π Stacking ──
  const ligandRings = detectLigandRings(ligandAtoms)
  const proteinRings = getProteinRings(proteinAtoms)
  const piPiStacks = []
  for (const lr of ligandRings) {
    const lCenter = centroid(lr)
    const lNormal = ringNormal(lr)
    for (const pr of proteinRings) {
      const pCenter = centroid(pr.atoms)
      const pNormal = ringNormal(pr.atoms)
      const d = dist(lCenter, pCenter)
      if (d > PI_PI_CUTOFF) continue
      const angle = normalAngle(lNormal, pNormal)
      // parallel (< 30°) or T-shaped (> 60°)
      if (angle > 30 && angle < 60) continue
      piPiStacks.push({
        chain1: ligandAtoms[0].chain, position1: ligandAtoms[0].resSeq,
        residue1: ligandAtoms[0].resName,
        chain2: pr.chain, position2: pr.resSeq, residue2: pr.resName,
        distance: Math.round(d * 1000) / 1000,
        angle: Math.round(angle * 100) / 100,
      })
    }
  }
  piPiStacks.sort((a, b) => a.distance - b.distance)

  // ── π-Cation ──
  const piCations = []
  // Ligand ring ↔ protein cation
  for (const lr of ligandRings) {
    const lCenter = centroid(lr)
    for (const pa of proteinAtoms) {
      const catAtoms = CATION_ATOMS[pa.resName]
      if (!catAtoms || !catAtoms.includes(pa.atomName)) continue
      const d = dist(lCenter, pa)
      if (d > PI_CATION_CUTOFF) continue
      piCations.push({
        ringChain: ligandAtoms[0].chain, ringPosition: ligandAtoms[0].resSeq,
        ringResidue: ligandAtoms[0].resName, ringLabel: 'ring',
        cationChain: pa.chain, cationPosition: pa.resSeq,
        cationResidue: pa.resName, cationAtom: pa.atomName,
        distance: Math.round(d * 1000) / 1000,
      })
    }
  }
  // Protein ring ↔ ligand cation (N atoms)
  const ligandCations = ligandAtoms.filter(a => a.element === 'N')
  for (const pr of proteinRings) {
    const pCenter = centroid(pr.atoms)
    for (const la of ligandCations) {
      const d = dist(pCenter, la)
      if (d > PI_CATION_CUTOFF) continue
      piCations.push({
        ringChain: pr.chain, ringPosition: pr.resSeq,
        ringResidue: pr.resName, ringLabel: 'ring',
        cationChain: la.chain, cationPosition: la.resSeq,
        cationResidue: la.resName, cationAtom: la.atomName,
        distance: Math.round(d * 1000) / 1000,
      })
    }
  }
  piCations.sort((a, b) => a.distance - b.distance)

  // ── Salt Bridge ──
  const saltBridges = []
  // Ligand anion (O connected to C=O pattern) ↔ protein cation
  const ligandAnionOs = ligandAtoms.filter(a => a.element === 'O')
  for (const lo of ligandAnionOs) {
    for (const pa of proteinAtoms) {
      const catAtoms = CATION_ATOMS[pa.resName]
      if (!catAtoms || !catAtoms.includes(pa.atomName)) continue
      const d = dist(lo, pa)
      if (d > SALT_BRIDGE_CUTOFF) continue
      saltBridges.push({
        chain1: lo.chain, position1: lo.resSeq,
        residue1: lo.resName, atom1: lo.atomName,
        chain2: pa.chain, position2: pa.resSeq,
        residue2: pa.resName, atom2: pa.atomName,
        distance: Math.round(d * 1000) / 1000,
      })
    }
  }
  // Ligand cation (N) ↔ protein anion
  for (const ln of ligandCations) {
    for (const pa of proteinAtoms) {
      const aniAtoms = ANION_ATOMS[pa.resName]
      if (!aniAtoms || !aniAtoms.includes(pa.atomName)) continue
      const d = dist(ln, pa)
      if (d > SALT_BRIDGE_CUTOFF) continue
      saltBridges.push({
        chain1: ln.chain, position1: ln.resSeq,
        residue1: ln.resName, atom1: ln.atomName,
        chain2: pa.chain, position2: pa.resSeq,
        residue2: pa.resName, atom2: pa.atomName,
        distance: Math.round(d * 1000) / 1000,
      })
    }
  }
  saltBridges.sort((a, b) => a.distance - b.distance)

  // ── Hydrophobic ──
  const ligandCarbons = ligandAtoms.filter(a => a.element === 'C')
  const hydrophobicMap = new Map()
  for (const lc of ligandCarbons) {
    for (const pa of proteinAtoms) {
      if (pa.element !== 'C') continue
      if (!HYDROPHOBIC_RESIDUES.has(pa.resName)) continue
      const d = dist(lc, pa)
      if (d > HYDROPHOBIC_CUTOFF) continue
      const key = `${pa.chain}:${pa.resSeq}`
      if (!hydrophobicMap.has(key) || d < hydrophobicMap.get(key).distance) {
        hydrophobicMap.set(key, {
          chain1: lc.chain, position1: lc.resSeq,
          residue1: lc.resName, atom1: lc.atomName,
          chain2: pa.chain, position2: pa.resSeq,
          residue2: pa.resName, atom2: pa.atomName,
          distance: Math.round(d * 1000) / 1000,
        })
      }
    }
  }
  const hydrophobics = [...hydrophobicMap.values()].sort((a, b) => a.distance - b.distance)

  return { hBonds, piPiStacks, piCations, saltBridges, hydrophobics }
}

// ── Protein–Protein interaction analysis (antibody–antigen) ──────────

export async function analyzeProteinProteinInteractions(pdbUrl, chainsA, chainsB) {
  const text = await fetch(pdbUrl).then(r => r.text())
  const lines = text.split('\n')

  const setA = new Set(chainsA)
  const setB = new Set(chainsB)
  const groupA = []
  const groupB = []

  for (const line of lines) {
    const atom = parsePdbLine(line)
    if (!atom || !atom.element) continue
    if (atom.recordType !== 'ATOM') continue
    if (setA.has(atom.chain)) groupA.push(atom)
    else if (setB.has(atom.chain)) groupB.push(atom)
  }

  // ── H-Bond ──
  const polarA = groupA.filter(a => POLAR_ELEMENTS.has(a.element))
  const polarB = groupB.filter(a => POLAR_ELEMENTS.has(a.element))
  const hBonds = []
  for (const a of polarA) {
    for (const b of polarB) {
      const d = dist(a, b)
      if (d > HBOND_CUTOFF) continue
      hBonds.push({
        donorChain: a.chain, donorPosition: a.resSeq,
        donorResidue: a.resName, donorAtom: a.atomName,
        acceptorChain: b.chain, acceptorPosition: b.resSeq,
        acceptorResidue: b.resName, acceptorAtom: b.atomName,
        distance: Math.round(d * 1000) / 1000,
      })
    }
  }
  hBonds.sort((a, b) => a.distance - b.distance)

  // ── π-π Stacking ──
  const ringsA = getProteinRings(groupA)
  const ringsB = getProteinRings(groupB)
  const piPiStacks = []
  for (const ra of ringsA) {
    const cA = centroid(ra.atoms), nA = ringNormal(ra.atoms)
    for (const rb of ringsB) {
      const cB = centroid(rb.atoms), nB = ringNormal(rb.atoms)
      const d = dist(cA, cB)
      if (d > PI_PI_CUTOFF) continue
      const angle = normalAngle(nA, nB)
      if (angle > 30 && angle < 60) continue
      piPiStacks.push({
        chain1: ra.chain, position1: ra.resSeq, residue1: ra.resName,
        chain2: rb.chain, position2: rb.resSeq, residue2: rb.resName,
        distance: Math.round(d * 1000) / 1000,
        angle: Math.round(angle * 100) / 100,
      })
    }
  }
  piPiStacks.sort((a, b) => a.distance - b.distance)

  // ── π-Cation ──
  const piCations = []
  // Group A rings ↔ Group B cations
  for (const ra of ringsA) {
    const cA = centroid(ra.atoms)
    for (const b of groupB) {
      const catAtoms = CATION_ATOMS[b.resName]
      if (!catAtoms || !catAtoms.includes(b.atomName)) continue
      const d = dist(cA, b)
      if (d > PI_CATION_CUTOFF) continue
      piCations.push({
        ringChain: ra.chain, ringPosition: ra.resSeq,
        ringResidue: ra.resName, ringLabel: 'ring',
        cationChain: b.chain, cationPosition: b.resSeq,
        cationResidue: b.resName, cationAtom: b.atomName,
        distance: Math.round(d * 1000) / 1000,
      })
    }
  }
  // Group B rings ↔ Group A cations
  for (const rb of ringsB) {
    const cB = centroid(rb.atoms)
    for (const a of groupA) {
      const catAtoms = CATION_ATOMS[a.resName]
      if (!catAtoms || !catAtoms.includes(a.atomName)) continue
      const d = dist(cB, a)
      if (d > PI_CATION_CUTOFF) continue
      piCations.push({
        ringChain: rb.chain, ringPosition: rb.resSeq,
        ringResidue: rb.resName, ringLabel: 'ring',
        cationChain: a.chain, cationPosition: a.resSeq,
        cationResidue: a.resName, cationAtom: a.atomName,
        distance: Math.round(d * 1000) / 1000,
      })
    }
  }
  piCations.sort((a, b) => a.distance - b.distance)

  // ── Salt Bridge ──
  const saltBridges = []
  // Group A cation ↔ Group B anion
  for (const a of groupA) {
    const catAtoms = CATION_ATOMS[a.resName]
    if (!catAtoms || !catAtoms.includes(a.atomName)) continue
    for (const b of groupB) {
      const aniAtoms = ANION_ATOMS[b.resName]
      if (!aniAtoms || !aniAtoms.includes(b.atomName)) continue
      const d = dist(a, b)
      if (d > SALT_BRIDGE_CUTOFF) continue
      saltBridges.push({
        chain1: a.chain, position1: a.resSeq,
        residue1: a.resName, atom1: a.atomName,
        chain2: b.chain, position2: b.resSeq,
        residue2: b.resName, atom2: b.atomName,
        distance: Math.round(d * 1000) / 1000,
      })
    }
  }
  // Group A anion ↔ Group B cation
  for (const a of groupA) {
    const aniAtoms = ANION_ATOMS[a.resName]
    if (!aniAtoms || !aniAtoms.includes(a.atomName)) continue
    for (const b of groupB) {
      const catAtoms = CATION_ATOMS[b.resName]
      if (!catAtoms || !catAtoms.includes(b.atomName)) continue
      const d = dist(a, b)
      if (d > SALT_BRIDGE_CUTOFF) continue
      saltBridges.push({
        chain1: a.chain, position1: a.resSeq,
        residue1: a.resName, atom1: a.atomName,
        chain2: b.chain, position2: b.resSeq,
        residue2: b.resName, atom2: b.atomName,
        distance: Math.round(d * 1000) / 1000,
      })
    }
  }
  saltBridges.sort((a, b) => a.distance - b.distance)

  // ── Hydrophobic ──
  const carbonsA = groupA.filter(a => a.element === 'C' && HYDROPHOBIC_RESIDUES.has(a.resName))
  const carbonsB = groupB.filter(a => a.element === 'C' && HYDROPHOBIC_RESIDUES.has(a.resName))
  const hydrophobicMap = new Map()
  for (const a of carbonsA) {
    for (const b of carbonsB) {
      const d = dist(a, b)
      if (d > HYDROPHOBIC_CUTOFF) continue
      const key = `${a.chain}:${a.resSeq}-${b.chain}:${b.resSeq}`
      if (!hydrophobicMap.has(key) || d < hydrophobicMap.get(key).distance) {
        hydrophobicMap.set(key, {
          chain1: a.chain, position1: a.resSeq,
          residue1: a.resName, atom1: a.atomName,
          chain2: b.chain, position2: b.resSeq,
          residue2: b.resName, atom2: b.atomName,
          distance: Math.round(d * 1000) / 1000,
        })
      }
    }
  }
  const hydrophobics = [...hydrophobicMap.values()].sort((a, b) => a.distance - b.distance)

  return { hBonds, piPiStacks, piCations, saltBridges, hydrophobics }
}
