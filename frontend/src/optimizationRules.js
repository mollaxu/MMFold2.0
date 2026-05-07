const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 }

export function buildRuleContext(taskType, summary, annotationGroups, liabilityHits, information) {
  const ctx = {
    taskType,
    ipTM: summary?.iptm ?? 0,
    pTM: summary?.ptm ?? 0,
    pLDDT: summary?.plddt ?? null,
    rankingScore: summary?.ranking_score ?? 0,
    abagScore: summary?.abag_score ?? null,
    hasClash: !!summary?.has_clash,
    liabilityHits: liabilityHits || [],
    cdrGroups: [],
    cdrH3Length: 0,
    pocketResidues: [],
    activeSiteResidues: [],
    entityCount: information?.entities?.length ?? 0,
  }

  if (taskType === 'enzyme') {
    const pocket = annotationGroups?.find(g => g.id === 'pocket')
    const active = annotationGroups?.find(g => g.id === 'active_sites')
    ctx.pocketResidues = pocket?.residues ?? []
    ctx.activeSiteResidues = active?.residues ?? []
  }

  if (taskType === 'antibody') {
    ctx.cdrGroups = (annotationGroups || []).filter(g => /^cdr_/i.test(g.id))
    const h3 = ctx.cdrGroups.find(g => /h3/i.test(g.id))
    ctx.cdrH3Length = h3?.residues?.length ?? 0
  }

  return ctx
}

const ENZYME_RULES = [
  {
    id: 'enz_selectivity',
    condition: ctx => ctx.pocketResidues.length >= 8,
    priority: 'medium',
    category: 'Selectivity',
    title: 'Substrate Selectivity Engineering',
    build(ctx) {
      return {
        summary: `Binding pocket contains ${ctx.pocketResidues.length} residues, providing multiple positions for selectivity tuning without disrupting the catalytic core.`,
        evidence: [
          `Binding pocket size: ${ctx.pocketResidues.length} residues`,
          `Active site integrity: ${ctx.activeSiteResidues.length} catalytic residues (preserved)`,
          `Interface confidence: ipTM = ${ctx.ipTM.toFixed(2)}`,
        ],
        strategy: 'Introduce bulkier side chains (e.g. Leu→Phe, Val→Trp) at pocket entrance residues (positions distant from catalytic triad) to narrow substrate access and improve selectivity.',
        relatedResidues: ctx.pocketResidues.filter(r =>
          !ctx.activeSiteResidues.some(a => a.chain === r.chain && a.seqId === r.seqId)
        ).slice(0, 5),
      }
    },
  },
  {
    id: 'enz_catalysis',
    condition: ctx => ctx.activeSiteResidues.length > 0 && ctx.pTM > 0.9,
    priority: 'medium',
    category: 'Catalysis',
    title: 'Active Site Second-Shell Optimization',
    build(ctx) {
      return {
        summary: `High structural confidence (pTM = ${ctx.pTM.toFixed(2)}) confirms a stable fold, enabling safe engineering of second-shell residues (4–6 Å from catalytic center) to enhance transition-state stabilization.`,
        evidence: [
          `pTM = ${ctx.pTM.toFixed(2)} (very high fold confidence)`,
          `Catalytic residues: ${ctx.activeSiteResidues.map(r => `${r.chain}:${r.resType}${r.seqId}`).join(', ')}`,
          `Ranking score: ${ctx.rankingScore.toFixed(3)}`,
        ],
        strategy: 'Optimize hydrogen-bond network around the oxyanion hole by introducing polar residues or adjusting H-bond geometry in second-shell positions to lower activation energy.',
        relatedResidues: ctx.activeSiteResidues,
      }
    },
  },
  {
    id: 'enz_stability',
    condition: ctx => ctx.rankingScore > 0.8,
    priority: 'low',
    category: 'Stability',
    title: 'Thermostability Enhancement',
    build(ctx) {
      return {
        summary: `Excellent overall structure quality (ranking score = ${ctx.rankingScore.toFixed(3)}) provides a robust baseline for distal rigidification to boost thermal tolerance for industrial applications.`,
        evidence: [
          `Ranking score: ${ctx.rankingScore.toFixed(3)}`,
          `pTM = ${ctx.pTM.toFixed(2)} (stable core fold)`,
          `No structural clashes: ${ctx.hasClash ? 'Yes' : 'No'}`,
        ],
        strategy: 'Introduce disulfide bonds in surface loops (Cys pairs < 6 Å apart, distal from active site) or substitute flexible Gly with Pro/Ala to reduce conformational entropy. Target: +5–10 °C Tm improvement.',
        relatedResidues: [],
      }
    },
  },
]

function hitOverlapsCdr(hit, cdrResidueSet) {
  for (let pos = hit.start; pos < hit.end; pos++) {
    if (cdrResidueSet.has(`${hit.chain}:${pos + 1}`)) return true
  }
  return false
}

function hitResiduesInCdr(hit, cdrResidueSet) {
  const residues = []
  for (let pos = hit.start; pos < hit.end; pos++) {
    const seqId = pos + 1
    const key = `${hit.chain}:${seqId}`
    if (cdrResidueSet.has(key)) {
      residues.push({ chain: hit.chain, seqId, resType: hit.matchedSeq?.[pos - hit.start] ?? '' })
    }
  }
  return residues
}

const ANTIBODY_RULES = [
  {
    id: 'ab_liability',
    condition: ctx => {
      const cdrResidueSet = new Set()
      for (const g of ctx.cdrGroups) {
        for (const r of g.residues || []) {
          cdrResidueSet.add(`${r.chain}:${r.seqId}`)
        }
      }
      return ctx.liabilityHits.some(h =>
        (h.risk === 'High' || h.risk === 'Medium') && hitOverlapsCdr(h, cdrResidueSet)
      )
    },
    priority: 'high',
    category: 'Developability',
    title: 'CDR Chemical Liability Remediation',
    build(ctx) {
      const cdrResidueSet = new Set()
      for (const g of ctx.cdrGroups) {
        for (const r of g.residues || []) {
          cdrResidueSet.add(`${r.chain}:${r.seqId}`)
        }
      }
      const cdrHits = ctx.liabilityHits.filter(h =>
        (h.risk === 'High' || h.risk === 'Medium') && hitOverlapsCdr(h, cdrResidueSet)
      )
      const allHitResidues = []
      for (const h of cdrHits) {
        allHitResidues.push(...hitResiduesInCdr(h, cdrResidueSet))
      }

      return {
        summary: `${cdrHits.length} chemical liability motif(s) detected within CDR regions, posing risks to shelf life and batch consistency.`,
        evidence: cdrHits.map(h =>
          `${h.group} (${h.motif}) at ${h.chain}:${h.start + 1}-${h.end} — ${h.risk} risk`
        ),
        strategy: 'Met→Leu/Ile (remove oxidation), Asn→Gln or downstream Ser→Thr (block deamidation motif), Trp→Phe if not critical for binding. Validate each mutation by SPR/BLI affinity assay.',
        relatedResidues: allHitResidues.slice(0, 6),
      }
    },
  },
  {
    id: 'ab_affinity',
    condition: ctx => ctx.ipTM < 0.7,
    priority: 'medium',
    category: 'Affinity',
    title: 'Interface Affinity Maturation',
    build(ctx) {
      return {
        summary: `Interface prediction confidence is moderate (ipTM = ${ctx.ipTM.toFixed(2)}), indicating room for affinity improvement through targeted mutations at the paratope-epitope interface.`,
        evidence: [
          `ipTM = ${ctx.ipTM.toFixed(2)} (moderate interface confidence)`,
          `abag_score = ${ctx.abagScore?.toFixed(3) ?? 'N/A'}`,
          `pTM = ${ctx.pTM.toFixed(2)}`,
        ],
        strategy: 'Apply computational affinity maturation: identify paratope hotspot residues via alanine scanning, then optimize with hydrophobic packing or charge complementarity mutations. Focus on CDR-H3 and CDR-L3 tips.',
        relatedResidues: [],
      }
    },
  },
  {
    id: 'ab_cdr_h3',
    condition: ctx => ctx.cdrH3Length > 15,
    priority: 'medium',
    category: 'Developability',
    title: 'CDR-H3 Loop Engineering',
    build(ctx) {
      const h3Group = ctx.cdrGroups.find(g => /h3/i.test(g.id))
      return {
        summary: `CDR-H3 is ${ctx.cdrH3Length} residues long — unusually extended loops increase aggregation propensity and reduce conformational stability, creating a manufacturing risk.`,
        evidence: [
          `CDR-H3 length: ${ctx.cdrH3Length} residues (typical: 9–15)`,
          `Overall pLDDT: ${ctx.pLDDT?.toFixed(1) ?? 'N/A'} (CDR-H3 local confidence likely lower)`,
          `Aggregation risk: elevated due to exposed hydrophobic residues in long loop`,
        ],
        strategy: 'Identify paratope contact residues in CDR-H3 via structure analysis. Design truncated variants (13–15 residues) preserving key contacts. Shorter loops reduce conformational entropy penalty, potentially improving both affinity and manufacturability.',
        relatedResidues: (h3Group?.residues ?? []).slice(0, 6),
      }
    },
  },
]

export function generateSuggestions(ctx) {
  const rules = ctx.taskType === 'antibody' ? ANTIBODY_RULES : ENZYME_RULES
  const suggestions = []

  for (const rule of rules) {
    if (rule.condition(ctx)) {
      const built = rule.build(ctx)
      suggestions.push({
        id: rule.id,
        priority: rule.priority,
        category: rule.category,
        title: rule.title,
        ...built,
      })
    }
  }

  suggestions.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
  return suggestions
}
