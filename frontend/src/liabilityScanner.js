const RULES = [
  // 脱酰胺 (Deamidation)
  { group: 'Deamidation', motif: 'NG', regex: /NG/g, risk: 'High', category: 'Chemical Stability' },
  { group: 'Deamidation', motif: 'NS', regex: /NS/g, risk: 'Medium', category: 'Chemical Stability' },
  { group: 'Deamidation', motif: 'NT', regex: /NT/g, risk: 'Medium', category: 'Chemical Stability' },
  { group: 'Deamidation', motif: 'NH', regex: /NH/g, risk: 'Medium', category: 'Chemical Stability' },
  { group: 'Deamidation', motif: 'NN', regex: /NN/g, risk: 'Medium', category: 'Chemical Stability' },
  { group: 'Deamidation', motif: 'NA', regex: /NA/g, risk: 'Low', category: 'Chemical Stability' },
  { group: 'Deamidation', motif: 'NE', regex: /NE/g, risk: 'Low', category: 'Chemical Stability' },
  { group: 'Deamidation', motif: 'NV', regex: /NV/g, risk: 'Low', category: 'Chemical Stability' },
  // 氧化 (Oxidation)
  { group: 'Oxidation', motif: 'M', regex: /M/g, risk: 'Medium', category: 'Chemical Stability' },
  { group: 'Oxidation', motif: 'W', regex: /W/g, risk: 'Medium', category: 'Chemical Stability' },
  { group: 'Oxidation', motif: 'H', regex: /H/g, risk: 'Low', category: 'Chemical Stability' },
  { group: 'Oxidation', motif: 'C', regex: /C/g, risk: 'Low', category: 'Chemical Stability' },
  // 异构化 (Isomerization)
  { group: 'Isomerization', motif: 'DG', regex: /DG/g, risk: 'High', category: 'Chemical Stability' },
  { group: 'Isomerization', motif: 'DS', regex: /DS/g, risk: 'Medium', category: 'Chemical Stability' },
  { group: 'Isomerization', motif: 'DT', regex: /DT/g, risk: 'Medium', category: 'Chemical Stability' },
  { group: 'Isomerization', motif: 'DH', regex: /DH/g, risk: 'Medium', category: 'Chemical Stability' },
  { group: 'Isomerization', motif: 'DD', regex: /DD/g, risk: 'Medium', category: 'Chemical Stability' },
  // 糖基化 (Glycosylation)
  { group: 'Glycosylation', motif: 'N-X-T', regex: /N[^P]T/g, risk: 'High', category: 'PTM' },
  { group: 'Glycosylation', motif: 'N-X-S', regex: /N[^P]S/g, risk: 'Medium', category: 'PTM' },
  // 游离巯基 (Free Thiol) — skipped if even Cys count
  { group: 'Free Thiol', motif: 'C', regex: /C/g, risk: 'High', category: 'Chemical Stability', freeCys: true },
  // 细胞粘附 (Cell Adhesion)
  { group: 'Cell Adhesion', motif: 'RGD', regex: /RGD/g, risk: 'Medium', category: 'Biological' },
  { group: 'Cell Adhesion', motif: 'LDV', regex: /LDV/g, risk: 'Medium', category: 'Biological' },
  { group: 'Cell Adhesion', motif: 'KGD', regex: /KGD/g, risk: 'Medium', category: 'Biological' },
  // 裂解 (Cleavage)
  { group: 'Cleavage', motif: 'DP', regex: /DP/g, risk: 'Medium', category: 'Chemical Stability' },
  { group: 'Cleavage', motif: 'DK', regex: /DK/g, risk: 'Low', category: 'Chemical Stability' },
  { group: 'Cleavage', motif: 'EA', regex: /EA/g, risk: 'Low', category: 'Chemical Stability' },
  { group: 'Cleavage', motif: 'TS', regex: /TS/g, risk: 'Low', category: 'Chemical Stability' },
  // 蛋白水解 (Proteolysis)
  { group: 'Proteolysis', motif: 'TS', regex: /TS/g, risk: 'Low', category: 'Chemical Stability' },
  { group: 'Proteolysis', motif: 'NP', regex: /NP/g, risk: 'Low', category: 'Chemical Stability' },
  // 环化 (Cyclization) — N-terminal only
  { group: 'Cyclization', motif: '^Q', regex: /^Q/, risk: 'Low', category: 'Chemical Stability', nTerminal: true },
  { group: 'Cyclization', motif: '^E', regex: /^E/, risk: 'Low', category: 'Chemical Stability', nTerminal: true },
  // 羟基化 (Hydroxylation)
  { group: 'Hydroxylation', motif: 'KG', regex: /KG/g, risk: 'High', category: 'PTM' },
  // 赖氨酸糖基化 (Lysine Glycation)
  { group: 'Lysine Glycation', motif: 'KE', regex: /KE/g, risk: 'Medium', category: 'PTM' },
  { group: 'Lysine Glycation', motif: 'KD', regex: /KD/g, risk: 'Medium', category: 'PTM' },
  { group: 'Lysine Glycation', motif: 'KK', regex: /KK/g, risk: 'Medium', category: 'PTM' },
  // 糖基化终产物 (AGE)
  { group: 'AGE', motif: 'K(other)', regex: /K(?![GEDK])/g, risk: 'Low', category: 'PTM' },
]

const RISK_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 }

export function scanSequence(sequence, chain) {
  const seq = sequence.toUpperCase()
  const hits = []
  const cysCount = (seq.match(/C/g) || []).length
  const skipFreeCys = cysCount % 2 === 0

  for (const rule of RULES) {
    if (rule.freeCys && skipFreeCys) continue

    const re = new RegExp(rule.regex.source, rule.regex.flags)
    let match
    while ((match = re.exec(seq)) !== null) {
      const pos = match.index
      const mockRsa = Math.round((Math.sin(pos * 0.37 + chain.charCodeAt(0)) * 0.5 + 0.5) * 80 + Math.random() * 20)
      hits.push({
        group: rule.group,
        motif: rule.motif,
        start: pos,
        end: pos + match[0].length,
        risk: rule.risk,
        category: rule.category,
        chain,
        matchedSeq: match[0],
        rsa: Math.min(100, Math.max(0, mockRsa)),
      })
      if (!rule.regex.global) break
    }
  }

  // Deduplicate by (start, group) — keep highest risk
  const seen = new Map()
  for (const h of hits) {
    const key = `${h.start}:${h.group}`
    const existing = seen.get(key)
    if (!existing || RISK_ORDER[h.risk] < RISK_ORDER[existing.risk]) {
      seen.set(key, h)
    }
  }

  const deduped = [...seen.values()]
  deduped.sort((a, b) => a.start - b.start || RISK_ORDER[a.risk] - RISK_ORDER[b.risk])
  return deduped
}

export function scanEntities(entities) {
  const allHits = []
  for (const entity of entities) {
    if (!entity.sequence) continue
    const hits = scanSequence(entity.sequence, entity.chain)
    allHits.push(...hits)
  }
  return allHits
}
