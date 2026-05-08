const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 }

const THREE_TO_ONE = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E',
  GLY: 'G', HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F',
  PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
}

// Residue-specific mutation guidance for interface affinity maturation
const AFFINITY_MUTATION_GUIDE = {
  SER: {
    suggestion: 'Ser→Tyr',
    rationale: 'Aromatic burial + retained H-bond',
    mechanism: 'Tyr is a privileged affinity maturation residue: the aromatic ring provides hydrophobic burial while the hydroxyl retains H-bond capacity. This substitution frequently appears in naturally affinity-matured antibodies.',
  },
  THR: {
    suggestion: 'Thr→Tyr or Thr→Phe',
    rationale: 'Expand hydrophobic burial area',
    mechanism: 'Replacing Thr with Tyr/Phe at the interface expands hydrophobic burial area and reduces the desolvation penalty, typically improving ΔG by 0.5–1.5 kcal/mol.',
  },
  GLY: {
    suggestion: 'Gly→Ala or Gly→Pro',
    rationale: 'Reduce loop conformational entropy',
    mechanism: 'Gly confers high conformational flexibility; substituting Ala reduces the entropy cost of binding-induced loop ordering. Pro is preferred in the middle of CDR loops to lock the bound conformation.',
  },
  ALA: {
    suggestion: 'Ala→Val or Ala→Ile',
    rationale: 'Fill hydrophobic cavity at interface',
    mechanism: 'Ala often leaves a hydrophobic cavity at the interface. Branched aliphatics (Val, Ile) improve van der Waals packing and displace ordered water molecules, contributing favorable entropic gain.',
  },
  VAL: {
    suggestion: 'Val→Ile or Val→Leu',
    rationale: 'Increase buried surface area',
    mechanism: 'Extending the side chain from Val to Ile or Leu fills interface cavities in the predicted structure, increasing buried surface area and van der Waals contact.',
  },
  ASN: {
    suggestion: 'Asn→Asp or Asn→Gln',
    rationale: 'Introduce salt bridge / remove liability',
    mechanism: 'Asn is both a deamidation liability and a relatively weak H-bond donor/acceptor. Asp introduces a negative charge that can form a salt bridge with antigen cationic patches, substantially lowering ΔG.',
  },
  GLN: {
    suggestion: 'Gln→Glu or Gln→Asn',
    rationale: 'Extend electrostatic complementarity',
    mechanism: 'Introducing a salt bridge between Glu and a nearby antigen Lys/Arg can lower binding free energy by 1–3 kcal/mol. Verify charge complementarity before mutating.',
  },
  MET: {
    suggestion: 'Met→Leu or Met→Ile',
    rationale: 'Remove oxidation risk; preserve burial',
    mechanism: 'Met oxidation directly reduces binding affinity and is a known manufacturing liability. Leu/Ile preserves hydrophobicity while eliminating the oxidation risk, protecting long-term potency.',
  },
  LYS: {
    suggestion: 'Lys→Arg',
    rationale: 'Bidentate H-bond + cation-π capacity',
    mechanism: 'Arg provides a more extended, planar guanidinium group capable of bidentate H-bonds and cation-π interactions with antigen aromatic residues, often outperforming Lys at buried interface positions.',
  },
  ARG: {
    suggestion: 'Arg→Trp (if aromatic pocket present)',
    rationale: 'π-stacking replaces electrostatic contact',
    mechanism: 'Arg at an interface hotspot can form cation-π interactions with aromatic residues on the antigen. If an aromatic pocket exists on the antigen, Trp substitution can provide stronger burial and π-stacking.',
  },
}

export function buildRuleContext(taskType, summary, annotationGroups, liabilityHits, information, interactions) {
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
    // Antibody interface data (populated below)
    cdrResidueSet: new Set(),
    cdrByResidue: new Map(),
    cdrHBonds: [],
    cdrHydrophobics: [],
    cdrPiPi: [],
    cdrSaltBridges: [],
  }

  if (taskType === 'enzyme') {
    const pocket = annotationGroups?.find(g => g.id === 'pocket')
    const active = annotationGroups?.find(g => g.id === 'active_sites')
    ctx.pocketResidues = pocket?.residues ?? []
    ctx.activeSiteResidues = active?.residues ?? []
    ctx.activeSiteSet = new Set(ctx.activeSiteResidues.map(r => `${r.chain}:${r.seqId}`))

    // Extract which pocket residues actually contact the ligand
    if (interactions) {
      const proteinInteracting = new Set()
      for (const b of interactions.hBonds || []) proteinInteracting.add(`${b.acceptorChain}:${b.acceptorPosition}`)
      for (const b of interactions.hydrophobics || []) proteinInteracting.add(`${b.chain2}:${b.position2}`)
      for (const b of interactions.piPiStacks || []) proteinInteracting.add(`${b.chain2}:${b.position2}`)
      for (const b of interactions.piCations || []) proteinInteracting.add(`${b.cationChain}:${b.cationPosition}`)
      ctx.interactingPocketResidues = ctx.pocketResidues.filter(r => proteinInteracting.has(`${r.chain}:${r.seqId}`))
      ctx.interactingActiveSiteResidues = ctx.activeSiteResidues.filter(r => proteinInteracting.has(`${r.chain}:${r.seqId}`))
      ctx.ligandHBondCount = (interactions.hBonds || []).length
      ctx.ligandHydrophobicCount = (interactions.hydrophobics || []).length
      ctx.ligandPiPiCount = (interactions.piPiStacks || []).length
    } else {
      ctx.interactingPocketResidues = []
      ctx.interactingActiveSiteResidues = []
      ctx.ligandHBondCount = 0
      ctx.ligandHydrophobicCount = 0
      ctx.ligandPiPiCount = 0
    }
  }

  if (taskType === 'antibody') {
    ctx.cdrGroups = (annotationGroups || []).filter(g => /^cdr_/i.test(g.id))
    const h3 = ctx.cdrGroups.find(g => /h3/i.test(g.id))
    ctx.cdrH3Length = h3?.residues?.length ?? 0

    // Build CDR residue lookup maps
    for (const g of ctx.cdrGroups) {
      const label = g.label || g.id.replace('cdr_', 'CDR-').toUpperCase()
      for (const r of g.residues || []) {
        const key = `${r.chain}:${r.seqId}`
        ctx.cdrResidueSet.add(key)
        ctx.cdrByResidue.set(key, label)
      }
    }

    // Extract interface interactions involving CDR residues
    if (interactions) {
      ctx.cdrHBonds = (interactions.hBonds || []).filter(b =>
        ctx.cdrResidueSet.has(`${b.donorChain}:${b.donorPosition}`) ||
        ctx.cdrResidueSet.has(`${b.acceptorChain}:${b.acceptorPosition}`)
      )
      ctx.cdrHydrophobics = (interactions.hydrophobics || []).filter(b =>
        ctx.cdrResidueSet.has(`${b.chain1}:${b.position1}`) ||
        ctx.cdrResidueSet.has(`${b.chain2}:${b.position2}`)
      )
      ctx.cdrPiPi = (interactions.piPiStacks || []).filter(b =>
        ctx.cdrResidueSet.has(`${b.chain1}:${b.position1}`) ||
        ctx.cdrResidueSet.has(`${b.chain2}:${b.position2}`)
      )
      ctx.cdrSaltBridges = (interactions.saltBridges || []).filter(b =>
        ctx.cdrResidueSet.has(`${b.chain1}:${b.position1}`) ||
        ctx.cdrResidueSet.has(`${b.chain2}:${b.position2}`)
      )
    }
  }

  return ctx
}

// Residue helpers for enzyme rules
const RESIDUE_IS_AROMATIC = new Set(['Y', 'W', 'F', 'H'])
const ENTRANCE_MUTATION = {
  G: { to: 'Ala / Pro', rationale: 'Rigidify flexible hinge; restrict entrance radius' },
  A: { to: 'Val',       rationale: 'Narrow channel via branched aliphatic side chain' },
  T: { to: 'Val',       rationale: 'Replace OH with aliphatic; narrow entrance' },
  S: { to: 'Ala',       rationale: 'Remove OH; reduce entrance polar character' },
}
const ACTIVE_SITE_LIABILITY = {
  M: { to: 'Leu',  rationale: 'Remove oxidation-prone sulfur adjacent to catalytic core' },
  C: { to: 'Ser',  rationale: 'Eliminate free thiol / disulfide scrambling risk' },
  N: { to: 'Gln',  rationale: 'Block deamidation in active site microenvironment' },
}
const SECOND_SHELL_MUTATION = {
  A: { to: 'Ser', rationale: 'Add H-bond donor for substrate positioning' },
  G: { to: 'Ala', rationale: 'Reduce backbone flexibility near catalytic residue' },
  V: { to: 'Thr', rationale: 'Introduce H-bond without steric clash' },
}

const ENZYME_RULES = [
  {
    id: 'enz_selectivity',
    condition: ctx => ctx.pocketResidues.some(r =>
      !ctx.activeSiteSet?.has(`${r.chain}:${r.seqId}`) && ENTRANCE_MUTATION[r.resType]
    ),
    priority: 'medium',
    category: 'Selectivity',
    title: 'Substrate Selectivity Engineering',
    build(ctx) {
      const entranceResidues = ctx.pocketResidues.filter(r =>
        !ctx.activeSiteSet?.has(`${r.chain}:${r.seqId}`) && ENTRANCE_MUTATION[r.resType]
      )
      const hasInteractions = ctx.interactingPocketResidues.length > 0
      const interactingLabels = ctx.interactingPocketResidues.map(r => `${r.chain}:${r.resType}${r.seqId}`)
      const pocketLabel = ctx.pocketResidues.map(r => `${r.resType}${r.seqId}`).join(', ')
      const activeSiteLabel = ctx.activeSiteResidues.map(r => `${r.resType}${r.seqId}`).join(', ')

      return {
        summary: `${entranceResidues.length} non-catalytic pocket position(s) — ${entranceResidues.map(r => `${r.resType}${r.seqId}`).join(', ')} — are small or flexible and can be substituted to narrow the substrate entrance without touching the catalytic core (${activeSiteLabel}).${hasInteractions ? ` Ligand contact analysis confirms ${ctx.interactingPocketResidues.length} pocket residue(s) directly contact the substrate.` : ''}`,
        evidence: [
          `Pocket residues (${ctx.pocketResidues.length}): ${pocketLabel}`,
          `Catalytic core (do not mutate): ${activeSiteLabel}`,
          `Entrance targets: ${entranceResidues.map(r => `${r.chain}:${r.resType}${r.seqId}`).join(', ')}`,
          hasInteractions ? `Ligand contacts detected: ${interactingLabels.join(', ')}` : null,
          `Interface confidence: ipTM = ${ctx.ipTM.toFixed(2)}`,
        ].filter(Boolean),
        strategy: `Mutate entrance residues one at a time. Compare Km for target vs. off-target substrates after each substitution. Note: G57 is shared with the stability target — coordinate both goals before committing to a substitution.`,
        mutationTable: entranceResidues.slice(0, 5).map(r => ({
          position: `${r.chain}:${r.resType}${r.seqId}`,
          from: r.resType === 'G' ? 'Gly' : r.resType === 'A' ? 'Ala' : r.resType === 'T' ? 'Thr' : r.resType,
          to: ENTRANCE_MUTATION[r.resType].to,
          region: 'Pocket entrance',
          rationale: ENTRANCE_MUTATION[r.resType].rationale,
          priority: r.resType === 'G' ? 'Medium' : 'Low',
        })),
        relatedResidues: entranceResidues.slice(0, 5),
      }
    },
  },
  {
    id: 'enz_active_site',
    condition: ctx =>
      ctx.activeSiteResidues.some(r => ACTIVE_SITE_LIABILITY[r.resType]) ||
      ctx.activeSiteResidues.some(r => !RESIDUE_IS_AROMATIC.has(r.resType) && r.resType !== 'H' && SECOND_SHELL_MUTATION[r.resType]),
    priority: 'medium',
    category: 'Catalysis',
    title: 'Active Site Liability & Second-Shell Optimization',
    build(ctx) {
      const liabilityResidues = ctx.activeSiteResidues.filter(r => ACTIVE_SITE_LIABILITY[r.resType])
      const secondShellResidues = ctx.activeSiteResidues.filter(r =>
        !ACTIVE_SITE_LIABILITY[r.resType] &&
        !RESIDUE_IS_AROMATIC.has(r.resType) &&
        r.resType !== 'H' &&
        SECOND_SHELL_MUTATION[r.resType]
      )
      const preservedResidues = ctx.activeSiteResidues.filter(r =>
        RESIDUE_IS_AROMATIC.has(r.resType) || r.resType === 'H'
      )

      const liabilityLabel = liabilityResidues.map(r => `${r.chain}:${r.resType}${r.seqId}`).join(', ')
      const preservedLabel = preservedResidues.map(r => `${r.resType}${r.seqId}`).join(', ')
      const hasInteractions = ctx.interactingActiveSiteResidues.length > 0

      return {
        summary: liabilityResidues.length > 0
          ? `Active site contains ${liabilityResidues.length} chemically labile residue(s) (${liabilityLabel}). Oxidation or deamidation at these positions directly degrades enzymatic activity over time. Substitution protects catalytic function while preserving the aromatic scaffold (${preservedLabel}).`
          : `Active site is chemically stable. Second-shell positions adjacent to the catalytic core (${secondShellResidues.map(r => `${r.resType}${r.seqId}`).join(', ')}) can be optimized to improve substrate positioning and transition-state stabilization.`,
        evidence: [
          liabilityResidues.length > 0 ? `Labile residues: ${liabilityLabel} — priority targets` : null,
          secondShellResidues.length > 0 ? `Second-shell candidates: ${secondShellResidues.map(r => `${r.chain}:${r.resType}${r.seqId}`).join(', ')}` : null,
          `Aromatic scaffold (preserve): ${preservedLabel}`,
          hasInteractions ? `Active site residues contacting ligand: ${ctx.interactingActiveSiteResidues.map(r => `${r.resType}${r.seqId}`).join(', ')}` : null,
          `pTM = ${ctx.pTM.toFixed(2)} · ranking score = ${ctx.rankingScore.toFixed(3)}`,
        ].filter(Boolean),
        strategy: `Address labile residues first (especially Met → oxidation directly reduces kcat). Then evaluate second-shell substitutions for substrate-positioning improvement. Validate each mutation individually by kcat/Km assay before combining.`,
        mutationTable: [
          ...liabilityResidues.slice(0, 3).map(r => ({
            position: `${r.chain}:${r.resType}${r.seqId}`,
            from: r.resType === 'M' ? 'Met' : r.resType === 'C' ? 'Cys' : 'Asn',
            to: ACTIVE_SITE_LIABILITY[r.resType].to,
            region: 'Active site',
            rationale: ACTIVE_SITE_LIABILITY[r.resType].rationale,
            priority: 'High',
          })),
          ...secondShellResidues.slice(0, 2).map(r => ({
            position: `${r.chain}:${r.resType}${r.seqId}`,
            from: r.resType === 'A' ? 'Ala' : r.resType === 'G' ? 'Gly' : 'Val',
            to: SECOND_SHELL_MUTATION[r.resType].to,
            region: 'Second-shell',
            rationale: SECOND_SHELL_MUTATION[r.resType].rationale,
            priority: 'Medium',
          })),
        ],
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
      const pocketGlys = ctx.pocketResidues.filter(r =>
        r.resType === 'G' && !ctx.activeSiteSet?.has(`${r.chain}:${r.seqId}`)
      )

      return {
        summary: `Structure quality is excellent (ranking score = ${ctx.rankingScore.toFixed(3)}, pTM = ${ctx.pTM.toFixed(2)}, no clashes). For additional thermostability, the primary target is ${pocketGlys.length > 0 ? `pocket Gly residue(s) (${pocketGlys.map(r => `${r.chain}:${r.resType}${r.seqId}`).join(', ')}) which introduce backbone flexibility at the entrance` : 'flexible surface loop regions'}. This overlaps with the selectivity goal — a shared G→Ala substitution serves both purposes.`,
        evidence: [
          `Ranking score: ${ctx.rankingScore.toFixed(3)} (high — stable baseline)`,
          `pTM = ${ctx.pTM.toFixed(2)} (stable core fold)`,
          `No structural clashes: ${ctx.hasClash ? 'detected' : 'none'}`,
          pocketGlys.length > 0 ? `Flexible pocket positions: ${pocketGlys.map(r => `${r.chain}:${r.resType}${r.seqId}`).join(', ')}` : null,
        ].filter(Boolean),
        strategy: `Coordinate with selectivity engineering: G→Ala at pocket Gly positions addresses both stability and selectivity simultaneously. For further thermostability, introduce engineered disulfide bonds in surface loops distal from the active site. Target: +5–10 °C Tm improvement.`,
        mutationTable: [
          ...pocketGlys.slice(0, 2).map(r => ({
            position: `${r.chain}:${r.resType}${r.seqId}`,
            from: 'Gly',
            to: 'Ala / Pro',
            region: 'Pocket loop',
            rationale: 'Reduce backbone flexibility; improve thermal stability',
            priority: 'Low',
          })),
          { position: 'Surface loop pair', from: 'Ser / Ala', to: 'Cys', region: 'Distal loop', rationale: 'Engineered disulfide pins loop in native conformation', priority: 'Low' },
        ],
        relatedResidues: pocketGlys,
      }
    },
  },
]

const AMINO_ACID_NAMES = {
  A: 'Ala', C: 'Cys', D: 'Asp', E: 'Glu', F: 'Phe', G: 'Gly', H: 'His',
  I: 'Ile', K: 'Lys', L: 'Leu', M: 'Met', N: 'Asn', P: 'Pro', Q: 'Gln',
  R: 'Arg', S: 'Ser', T: 'Thr', V: 'Val', W: 'Trp', Y: 'Tyr',
}

const MECHANISM_DESC = {
  Deamidation: 'Asn side-chain deamidation via succinimide intermediate under neutral-basic pH; accelerated at elevated temperature.',
  Oxidation: 'Side-chain oxidation under light exposure, peroxide, or metal-ion catalysis; may alter binding affinity.',
  Isomerization: 'Asp isomerization to iso-Asp through succinimide ring formation; affects backbone geometry.',
  Glycosylation: 'N-linked glycosylation sequon recognized by OST in ER; heterogeneous glycan profiles affect PK/PD.',
  'Free Thiol': 'Unpaired cysteine may form non-native disulfides or undergo oxidation, causing aggregation.',
  Cleavage: 'Acid-labile peptide bond susceptible to hydrolysis under low-pH stress conditions.',
}

const LIABILITY_FIX = {
  Oxidation:    { from: 'Met', to: 'Leu / Ile', rationale: 'Remove oxidation-prone sulfur' },
  Deamidation:  { from: 'Asn', to: 'Gln',       rationale: 'Block succinimide intermediate' },
  Isomerization:{ from: 'Asp', to: 'Glu',        rationale: 'Prevent iso-Asp backbone shift' },
  'Free Thiol': { from: 'Cys', to: 'Ser',        rationale: 'Eliminate non-native disulfide risk' },
  Glycosylation:{ from: 'Asn', to: 'Gln',        rationale: 'Remove N-glycosylation sequon' },
  Cleavage:     { from: 'Asp-Pro', to: 'Glu-Pro', rationale: 'Replace acid-labile bond' },
}

function findCdrRegion(hit, cdrGroups) {
  for (const g of cdrGroups) {
    for (let pos = hit.start; pos < hit.end; pos++) {
      const seqId = pos + 1
      if ((g.residues || []).some(r => r.chain === hit.chain && r.seqId === seqId)) {
        return g.label || g.id.replace('cdr_', 'CDR-').toUpperCase()
      }
    }
  }
  return null
}

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
    condition: ctx => ctx.liabilityHits.some(h =>
      (h.risk === 'High' || h.risk === 'Medium') && hitOverlapsCdr(h, ctx.cdrResidueSet)
    ),
    priority: 'high',
    category: 'Developability',
    title: 'CDR Chemical Liability Remediation',
    build(ctx) {
      const cdrHits = ctx.liabilityHits.filter(h =>
        (h.risk === 'High' || h.risk === 'Medium') && hitOverlapsCdr(h, ctx.cdrResidueSet)
      )
      const allHitResidues = []
      for (const h of cdrHits) {
        allHitResidues.push(...hitResiduesInCdr(h, ctx.cdrResidueSet))
      }

      return {
        summary: `${cdrHits.length} chemical liability motif(s) detected within CDR regions, posing risks to shelf life and batch consistency.`,
        evidence: cdrHits.map(h => {
          const cdrRegion = findCdrRegion(h, ctx.cdrGroups)
          const rsaLabel = h.rsa != null ? (h.rsa > 50 ? 'Exposed' : 'Buried') : null
          const posParts = []
          for (let p = h.start; p < h.end; p++) {
            const aa = h.matchedSeq?.[p - h.start] || ''
            posParts.push(`${AMINO_ACID_NAMES[aa] || aa}${p + 1}`)
          }
          return {
            type: h.group,
            motif: h.motif,
            position: `${h.chain}:${posParts.join(', ')}`,
            cdr: cdrRegion,
            risk: h.risk,
            rsa: h.rsa,
            rsaLabel,
            mechanism: MECHANISM_DESC[h.group] || null,
            residues: hitResiduesInCdr(h, ctx.cdrResidueSet),
          }
        }),
        strategy: `${cdrHits.length} CDR liabilit${cdrHits.length > 1 ? 'ies' : 'y'} flagged. Apply conservative substitutions below — prioritize High-risk sites first. Validate binding retention by SPR/BLI after each change.`,
        mutationTable: cdrHits.map(h => {
          const fix = LIABILITY_FIX[h.group] || { from: '?', to: '?', rationale: 'Eliminate liability' }
          const cdrRegion = findCdrRegion(h, ctx.cdrGroups) || 'CDR'
          const aa = h.matchedSeq?.[0] || ''
          const posLabel = `${h.chain}:${AMINO_ACID_NAMES[aa] || aa}${h.start + 1}`
          return {
            position: posLabel,
            from: fix.from,
            to: fix.to,
            region: cdrRegion,
            rationale: fix.rationale,
            priority: h.risk,
          }
        }),
      }
    },
  },
  {
    id: 'ab_affinity',
    condition: ctx =>
      ctx.ipTM < 0.8 ||
      ctx.cdrHBonds.length > 0 ||
      ctx.cdrHydrophobics.length > 0 ||
      ctx.cdrPiPi.length > 0 ||
      ctx.cdrSaltBridges.length > 0,
    priority: 'medium',
    category: 'Affinity',
    title: 'Interface Affinity Maturation',
    build(ctx) {
      // Aggregate all interface CDR residues across interaction types
      const interfaceMap = new Map()

      const trackResidue = (chain, position, resName, type) => {
        const key = `${chain}:${position}`
        if (!ctx.cdrResidueSet.has(key)) return
        if (!interfaceMap.has(key)) {
          interfaceMap.set(key, {
            chain,
            seqId: position,
            resName,
            cdr: ctx.cdrByResidue.get(key) || 'CDR',
            types: new Set(),
          })
        }
        interfaceMap.get(key).types.add(type)
      }

      for (const b of ctx.cdrHBonds) {
        trackResidue(b.donorChain, b.donorPosition, b.donorResidue, 'H-bond')
        trackResidue(b.acceptorChain, b.acceptorPosition, b.acceptorResidue, 'H-bond')
      }
      for (const b of ctx.cdrHydrophobics) {
        trackResidue(b.chain1, b.position1, b.residue1, 'Hydrophobic')
        trackResidue(b.chain2, b.position2, b.residue2, 'Hydrophobic')
      }
      for (const b of ctx.cdrPiPi) {
        trackResidue(b.chain1, b.position1, b.residue1, 'π-π Stacking')
        trackResidue(b.chain2, b.position2, b.residue2, 'π-π Stacking')
      }
      for (const b of ctx.cdrSaltBridges) {
        trackResidue(b.chain1, b.position1, b.residue1, 'Salt Bridge')
        trackResidue(b.chain2, b.position2, b.residue2, 'Salt Bridge')
      }

      // Sort by interaction richness (most interactions first), then by CDR priority (H3 > L3 > others)
      const CDR_PRIORITY = { 'CDR-H3': 0, 'CDR-L3': 1, 'CDR-H2': 2, 'CDR-L2': 3, 'CDR-H1': 4, 'CDR-L1': 5 }
      const hotspots = [...interfaceMap.values()].sort((a, b) => {
        const typeDiff = b.types.size - a.types.size
        if (typeDiff !== 0) return typeDiff
        return (CDR_PRIORITY[a.cdr] ?? 9) - (CDR_PRIORITY[b.cdr] ?? 9)
      })

      const topHotspots = hotspots.slice(0, 6)
      const hasInteractions = hotspots.length > 0

      // Build structured evidence items
      const evidence = hasInteractions
        ? topHotspots.map(r => {
            const guide = AFFINITY_MUTATION_GUIDE[r.resName] || null
            const typesArr = [...r.types]
            const priority = r.types.size >= 2 ? 'High' : r.types.has('H-bond') || r.types.has('Salt Bridge') ? 'Medium' : 'Low'
            return {
              type: typesArr.join(' / '),
              motif: guide?.suggestion ?? `${THREE_TO_ONE[r.resName] || r.resName}${r.seqId}`,
              position: `${r.chain}:${r.resName}${r.seqId}`,
              cdr: r.cdr,
              risk: priority,
              rsa: null,
              rsaLabel: null,
              mechanism: guide?.mechanism ?? null,
              residues: [{ chain: r.chain, seqId: r.seqId, resType: THREE_TO_ONE[r.resName] || r.resName[0] }],
            }
          })
        : [
            `ipTM = ${ctx.ipTM.toFixed(2)} (interface prediction confidence)`,
            `pTM = ${ctx.pTM.toFixed(2)} (overall fold confidence)`,
            ctx.abagScore != null ? `abag_score = ${ctx.abagScore.toFixed(3)}` : null,
          ].filter(Boolean)

      // Dynamic summary
      let summary
      if (hasInteractions) {
        const contactTypes = []
        if (ctx.cdrHBonds.length > 0) contactTypes.push(`${ctx.cdrHBonds.length} H-bond${ctx.cdrHBonds.length > 1 ? 's' : ''}`)
        if (ctx.cdrHydrophobics.length > 0) contactTypes.push('hydrophobic contacts')
        if (ctx.cdrPiPi.length > 0) contactTypes.push('π-π stacking')
        if (ctx.cdrSaltBridges.length > 0) contactTypes.push('salt bridges')
        summary = `Structure analysis identified ${hotspots.length} CDR residue${hotspots.length > 1 ? 's' : ''} at the paratope–epitope interface via ${contactTypes.join(', ')} (ipTM = ${ctx.ipTM.toFixed(2)}). Targeted substitutions at these contact positions can lower binding free energy (ΔG) without disrupting overall paratope geometry.`
      } else {
        summary = `Interface prediction confidence is moderate (ipTM = ${ctx.ipTM.toFixed(2)}). Load the interaction panel to identify specific CDR contact residues and enable structure-informed mutation recommendations.`
      }

      // Mutation table from hotspots that have known guides
      const mutationTable = hasInteractions
        ? topHotspots
            .filter(r => AFFINITY_MUTATION_GUIDE[r.resName])
            .map(r => {
              const guide = AFFINITY_MUTATION_GUIDE[r.resName]
              const primarySuggestion = guide.suggestion.split(' or ')[0]
              const parts = primarySuggestion.split('→')
              const to = parts[1]?.trim() || '?'
              const priority = r.types.size >= 2 ? 'High' : r.types.has('H-bond') || r.types.has('Salt Bridge') ? 'Medium' : 'Low'
              return {
                position: `${r.chain}:${THREE_TO_ONE[r.resName] || r.resName[0]}${r.seqId}`,
                from: r.resName.charAt(0) + r.resName.slice(1).toLowerCase(),
                to,
                region: r.cdr || 'CDR',
                rationale: guide.rationale,
                priority,
              }
            })
        : []

      // Strategy text (short intro; table carries the specifics)
      let strategy
      if (hasInteractions) {
        const notes = []
        if (ctx.cdrSaltBridges.length > 0) notes.push('preserve existing salt bridges')
        if (ctx.cdrPiPi.length > 0) notes.push('maintain π-π stacking contacts (Phe→Tyr adds H-bond capacity)')
        const noteStr = notes.length ? ` Note: ${notes.join('; ')}.` : ''
        strategy = `Prioritize CDR-H3 and CDR-L3 hotspots first. Introduce mutations one at a time and assess stability before combining.${noteStr} Validate each candidate by SPR/BLI before proceeding.`
      } else {
        strategy = `Apply CDR-focused scanning: prioritize CDR-H3 and CDR-L3 as primary affinity drivers. Introduce Tyr at Ser/Thr contact positions for aromatic burial; Ile/Leu at small aliphatic positions to fill interface cavities. Validate by SPR/BLI.`
      }

      return {
        summary,
        evidence,
        strategy,
        mutationTable,
        relatedResidues: topHotspots.map(r => ({
          chain: r.chain,
          seqId: r.seqId,
          resType: THREE_TO_ONE[r.resName] || r.resName[0],
        })),
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
