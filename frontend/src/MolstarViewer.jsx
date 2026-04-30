import { useEffect, useRef, useState } from 'react'
import 'molstar/build/viewer/molstar.css'

let plddtThemeName = null
let electrostaticThemeName = null

export default function MolstarViewer({
  structureUrl,
  highlightedResidues,
  focusedResidue,
  representationMode = 'surface',
  taskType = 'enzyme',
  superimposeUrl,
  onResidueClick,
  colorMode = 'plddt',
  autoFocusLigand = false,
}) {
  const parentRef = useRef(null)
  const pluginRef = useRef(null)
  const focusRefRef = useRef(null)
  const superimposeRef = useRef(null)
  const onResidueClickRef = useRef(onResidueClick)
  onResidueClickRef.current = onResidueClick
  const reprModeRef = useRef(representationMode)
  reprModeRef.current = representationMode
  const taskTypeRef = useRef(taskType)
  taskTypeRef.current = taskType
  const colorModeRef = useRef(colorMode)
  colorModeRef.current = colorMode
  const autoFocusLigandRef = useRef(autoFocusLigand)
  autoFocusLigandRef.current = autoFocusLigand
  const clickFromStructureRef = useRef(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [structureReady, setStructureReady] = useState(false)

  // ── Init plugin + load structure ──────────────────────────────────
  useEffect(() => {
    if (!parentRef.current) return

    let mounted = true
    let plugin = null
    const container = document.createElement('div')
    container.style.cssText = 'width:100%;height:100%'
    parentRef.current.appendChild(container)

    ;(async () => {
      try {
        setIsLoading(true)
        setError(null)
        setStructureReady(false)
        focusRefRef.current = null

        const { createPluginUI } = await import('molstar/lib/commonjs/mol-plugin-ui')
        const { renderReact18 } = await import('molstar/lib/commonjs/mol-plugin-ui/react18')
        const { DefaultPluginUISpec } = await import('molstar/lib/commonjs/mol-plugin-ui/spec')

        if (!mounted) return

        const NoopControls = () => null
        plugin = await createPluginUI({
          target: container,
          render: renderReact18,
          spec: {
            ...DefaultPluginUISpec(),
            layout: { initial: { isExpanded: false, showControls: false } },
            components: {
              remoteState: 'none',
              viewport: { controls: NoopControls, view: undefined },
            },
          },
        })

        pluginRef.current = plugin

        const data = await plugin.builders.data.download(
          { url: structureUrl, isBinary: false },
          { state: { isGhost: false } }
        )
        const trajectory = await plugin.builders.structure.parseTrajectory(data, 'pdb')
        await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default')

        const { PluginCommands } = await import('molstar/lib/commonjs/mol-plugin/commands')
        const { Color } = await import('molstar/lib/commonjs/mol-util/color')
        PluginCommands.Canvas3D.SetSettings(plugin, {
          settings: p => {
            p.renderer.backgroundColor = Color(0x1a1d24)
          },
        })
        try {
          plugin.canvas3d?.setProps({ helper: { axes: { name: 'off', params: {} } } })
        } catch {}


        await registerPlddtTheme(plugin)
        await registerElectrostaticTheme(plugin)
        await applyRepresentationMode(plugin, reprModeRef.current, taskTypeRef.current, colorModeRef.current)
        await PluginCommands.Camera.Reset(plugin)

        const { StructureElement, StructureProperties: SP } = await import(
          'molstar/lib/commonjs/mol-model/structure'
        )
        plugin.behaviors.interaction.click.subscribe(({ current }) => {
          if (!mounted || !onResidueClickRef.current) return
          const { loci } = current
          if (!StructureElement.Loci.is(loci) || StructureElement.Loci.isEmpty(loci)) {
            clickFromStructureRef.current = true
            onResidueClickRef.current(null)
            return
          }
          const e = loci.elements[0]
          if (!e) { clickFromStructureRef.current = true; onResidueClickRef.current(null); return }
          const loc = StructureElement.Location.create(loci.structure)
          loc.unit = e.unit
          loc.element = e.unit.elements[e.indices[0]]
          clickFromStructureRef.current = true
          onResidueClickRef.current({
            chain: SP.chain.auth_asym_id(loc),
            seqId: SP.residue.auth_seq_id(loc),
            resType: SP.atom.auth_comp_id(loc),
          })
        })

        if (mounted) { setIsLoading(false); setStructureReady(true) }
      } catch (err) {
        console.error('Molstar init failed:', err)
        if (mounted) { setError(err?.message ?? 'Failed to load structure'); setIsLoading(false) }
      }
    })()

    return () => {
      mounted = false
      try { plugin?.dispose() } catch {}
      pluginRef.current = null
      focusRefRef.current = null
      setStructureReady(false)
      container.remove()
    }
  }, [structureUrl])

  // ── Apply representation mode (cartoon / surface) ─────────────────
  useEffect(() => {
    if (!structureReady || !pluginRef.current) return
    applyRepresentationMode(pluginRef.current, representationMode, taskType, colorMode)
  }, [structureReady, representationMode, taskType])

  // ── Apply color mode change only ────────────────────────────────────
  useEffect(() => {
    if (!structureReady || !pluginRef.current) return
    applyColoring(pluginRef.current, colorMode)
  }, [structureReady, colorMode])

  // ── Highlight: hovered + pinned groups combined ───────────────────
  useEffect(() => {
    if (!structureReady || !pluginRef.current) return
    if (highlightedResidues?.length) {
      applyGroupHighlight(pluginRef.current, highlightedResidues)
    } else {
      clearGroupHighlight(pluginRef.current)
    }
  }, [structureReady, highlightedResidues])

  // ── Click: native selection + camera focus + bond display ──────────
  useEffect(() => {
    if (!structureReady || !pluginRef.current) return
    if (clickFromStructureRef.current) {
      clickFromStructureRef.current = false
      return
    }
    if (focusedResidue) {
      applyResidueFocus(pluginRef.current, focusedResidue, focusRefRef)
    } else {
      clearResidueFocus(pluginRef.current, focusRefRef)
    }
  }, [structureReady, focusedResidue])

  // ── Superimpose: load/remove homolog structure ────────────────────
  useEffect(() => {
    if (!structureReady || !pluginRef.current) return
    const plugin = pluginRef.current

    if (!superimposeUrl) {
      if (superimposeRef.current) {
        removeSuperimpose(plugin, superimposeRef)
      }
      return
    }

    ;(async () => {
      if (superimposeRef.current) {
        await removeSuperimpose(plugin, superimposeRef)
      }
      await loadSuperimpose(plugin, superimposeUrl, superimposeRef, taskTypeRef.current)
    })()
  }, [structureReady, superimposeUrl])

  // ── Auto-focus ligand to trigger Mol* interaction display ──────────
  useEffect(() => {
    if (!structureReady || !pluginRef.current || !autoFocusLigand) return
    ;(async () => {
      try {
        const { MolScriptBuilder: MS } = await import('molstar/lib/commonjs/mol-script/language/builder')
        const expression = MS.struct.generator.atomGroups({
          'chain-test': MS.core.logic.not([
            MS.core.set.has([MS.set('A'), MS.ammp('auth_asym_id')])
          ]),
        })
        const loci = await getLoci(pluginRef.current, expression)
        if (!loci) return
        pluginRef.current.managers.structure.focus.setFromLoci(loci)
      } catch (err) {
        console.warn('Auto-focus ligand failed:', err)
      }
    })()
  }, [structureReady, autoFocusLigand])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {isLoading && (
        <div className="mol-overlay"><span>Loading 3D structure...</span></div>
      )}
      {error && (
        <div className="mol-overlay mol-error">
          <span>Failed to load structure</span>
          <small>{error}</small>
        </div>
      )}
      <div ref={parentRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────

async function buildResidueExpression(residues) {
  const { MolScriptBuilder: MS } = await import('molstar/lib/commonjs/mol-script/language/builder')
  const byChain = {}
  for (const { chain, seqId } of residues) {
    ;(byChain[chain] ??= []).push(seqId)
  }
  const exprs = Object.entries(byChain).map(([ch, ids]) =>
    MS.struct.generator.atomGroups({
      'chain-test': MS.core.rel.eq([MS.ammp('auth_asym_id'), ch]),
      'residue-test': MS.core.set.has([MS.set(...ids), MS.ammp('auth_seq_id')]),
    })
  )
  return exprs.length === 1 ? exprs[0] : MS.struct.combinator.merge(exprs)
}

async function getLoci(plugin, expression) {
  const { Script } = await import('molstar/lib/commonjs/mol-script/script')
  const { StructureSelection } = await import('molstar/lib/commonjs/mol-model/structure')
  const structure = plugin.managers.structure.hierarchy.current.structures[0]?.cell.obj?.data
  if (!structure) return null
  const sel = Script.getStructureSelection(expression, structure)
  return StructureSelection.toLociWithSourceUnits(sel)
}

// ── Hover highlight ───────────────────────────────────────────────────

async function applyGroupHighlight(plugin, residues) {
  try {
    const expression = await buildResidueExpression(residues)
    const loci = await getLoci(plugin, expression)
    if (!loci) return
    plugin.managers.interactivity.lociHighlights.highlightOnly({ loci, repr: void 0 })
  } catch (err) {
    console.warn('Group highlight failed:', err)
  }
}

function clearGroupHighlight(plugin) {
  try {
    plugin.managers.interactivity.lociHighlights.clearHighlights()
  } catch (err) {
    console.warn('Clear highlight failed:', err)
  }
}

// ── Residue focus ──

async function applyResidueFocus(plugin, residue, focusRefRef) {
  const { MolScriptBuilder: MS } = await import('molstar/lib/commonjs/mol-script/language/builder')

  if (!plugin.managers.structure.hierarchy.current.structures.length) return

  clearResidueFocus(plugin, focusRefRef)

  const { chain, seqId } = residue
  const expression = MS.struct.generator.atomGroups({
    'chain-test': MS.core.rel.eq([MS.ammp('auth_asym_id'), chain]),
    'residue-test': MS.core.rel.eq([MS.ammp('auth_seq_id'), seqId]),
  })

  let loci = null
  try { loci = await getLoci(plugin, expression) } catch {}
  if (!loci) return

  try {
    plugin.managers.structure.focus.setFromLoci(loci)
  } catch (err) {
    console.warn('Focus manager failed:', err)
  }

  try {
    plugin.managers.camera.focusLoci(loci, { durationMs: 500 })
  } catch {}
}

function clearResidueFocus(plugin, focusRefRef) {
  focusRefRef.current = null
  try { plugin.managers.structure.focus.clear() } catch {}
  try { plugin.managers.structure.selection.clear() } catch {}
}

// ── Representation mode switching ────────────────────────────────────

async function replaceRepresentation(plugin, component, newType) {
  const reprs = [...(component.representations || [])]
  for (const r of reprs) {
    await plugin.managers.structure.hierarchy.remove([r], true)
  }
  await plugin.builders.structure.representation.addRepresentation(component.cell, { type: newType })
}

async function applyRepresentationMode(plugin, mode, taskType, colorMode = 'plddt') {
  try {
    const structures = plugin.managers.structure.hierarchy.current.structures
    if (!structures.length) return

    if (mode === 'cartoon') {
      for (const s of structures) {
        for (const c of s.components) {
          if (!c.representations?.length) continue
          const label = (c.cell?.obj?.label || '').toLowerCase()
          const isLigand = label.includes('ligand') || label.includes('ion') || label.includes('water')
          await replaceRepresentation(plugin, c, isLigand ? 'ball-and-stick' : 'cartoon')
        }
      }
    } else if (taskType === 'antibody') {
      await applyAntibodySurface(plugin)
    } else {
      await applyEnzymeSurface(plugin)
    }

    await applyColoring(plugin, colorMode)
  } catch (err) {
    console.warn('Representation mode switch failed:', err)
  }
}

async function applyEnzymeSurface(plugin) {
  for (const s of plugin.managers.structure.hierarchy.current.structures) {
    for (const c of s.components) {
      if (!c.representations?.length) continue
      const label = (c.cell?.obj?.label || '').toLowerCase()
      if (label.includes('polymer') || label.includes('protein')) {
        await replaceRepresentation(plugin, c, 'molecular-surface')
      }
    }
  }
}

async function applyAntibodySurface(plugin) {
  const { MolScriptBuilder: MS } = await import('molstar/lib/commonjs/mol-script/language/builder')

  for (const s of plugin.managers.structure.hierarchy.current.structures) {
    const alreadySplit = s.components.some(c =>
      (c.cell?.obj?.label || '').includes('Antibody')
    )

    if (alreadySplit) {
      for (const c of s.components) {
        if (!c.representations?.length) continue
        const label = c.cell?.obj?.label || ''
        if (label.includes('Antigen') || label.includes('Antibody')) {
          await replaceRepresentation(plugin, c, 'molecular-surface')
        }
      }
      return
    }

    const polymerComps = s.components.filter(c =>
      (c.cell?.obj?.label || '').toLowerCase().includes('polymer')
    )
    for (const c of polymerComps) {
      await plugin.managers.structure.hierarchy.remove([c], true)
    }

    const abExpr = MS.struct.generator.atomGroups({
      'chain-test': MS.core.set.has([MS.set('A', 'B'), MS.ammp('auth_asym_id')]),
    })
    const abComp = await plugin.builders.structure.tryCreateComponentFromExpression(
      s.cell, abExpr, 'antibody-chains', { label: 'Antibody (A, B)' }
    )
    if (abComp) {
      await plugin.builders.structure.representation.addRepresentation(abComp, { type: 'molecular-surface' })
    }

    const agExpr = MS.struct.generator.atomGroups({
      'chain-test': MS.core.rel.eq([MS.ammp('auth_asym_id'), 'C']),
    })
    const agComp = await plugin.builders.structure.tryCreateComponentFromExpression(
      s.cell, agExpr, 'antigen-chain', { label: 'Antigen (C)' }
    )
    if (agComp) {
      await plugin.builders.structure.representation.addRepresentation(agComp, { type: 'molecular-surface' })
    }
  }
}

// ── Superimpose ──────────────────────────────────────────────────────

async function loadSuperimpose(plugin, url, ref, taskType = 'enzyme') {
  try {
    const { Color } = await import('molstar/lib/commonjs/mol-util/color')
    const { MolScriptBuilder: MS } = await import('molstar/lib/commonjs/mol-script/language/builder')
    const { compile } = await import('molstar/lib/commonjs/mol-script/runtime/query/compiler')
    const { StructureSelection, StructureElement, QueryContext } = await import(
      'molstar/lib/commonjs/mol-model/structure'
    )
    const { alignAndSuperpose } = await import(
      'molstar/lib/commonjs/mol-model/structure/structure/util/superposition'
    )
    const { StateTransforms } = await import('molstar/lib/commonjs/mol-plugin-state/transforms')

    const mainStructures = plugin.managers.structure.hierarchy.current.structures
    if (!mainStructures.length) return
    const mainStructureData = mainStructures[0].cell.obj?.data
    if (!mainStructureData) return

    const data = await plugin.builders.data.download(
      { url, isBinary: false, label: 'homolog' },
      { state: { isGhost: false } }
    )
    const format = url.endsWith('.cif') || url.endsWith('.mmcif') ? 'mmcif' : 'pdb'
    const trajectory = await plugin.builders.structure.parseTrajectory(data, format)
    const model = await plugin.builders.structure.createModel(trajectory)
    const structure = await plugin.builders.structure.createStructure(model)

    ref.current = { data: data.ref }

    const homologData = structure.cell?.obj?.data
    if (!homologData) return

    const mainCaQuery = compile(MS.struct.generator.atomGroups({
      'atom-test': MS.core.rel.eq([
        MS.struct.atomProperty.macromolecular.label_atom_id(), 'CA'
      ]),
      ...(taskType === 'antibody' ? {
        'chain-test': MS.core.rel.eq([MS.ammp('auth_asym_id'), 'A']),
      } : {}),
    }))
    const homologCaQuery = compile(MS.struct.generator.atomGroups({
      'atom-test': MS.core.rel.eq([
        MS.struct.atomProperty.macromolecular.label_atom_id(), 'CA'
      ]),
    }))
    const sel1 = StructureSelection.toLociWithCurrentUnits(mainCaQuery(new QueryContext(mainStructureData)))
    const sel2 = StructureSelection.toLociWithCurrentUnits(homologCaQuery(new QueryContext(homologData)))

    if (StructureElement.Loci.size(sel1) > 0 && StructureElement.Loci.size(sel2) > 0) {
      const transforms = alignAndSuperpose([sel1, sel2])
      if (transforms.length > 0) {
        const b = plugin.state.data.build().to(structure)
          .insert(StateTransforms.Model.TransformStructureConformation, {
            transform: { name: 'matrix', params: { data: transforms[0].bTransform, transpose: false } }
          })
        await plugin.runTask(plugin.state.data.updateTree(b))
      }
    }

    const component = await plugin.builders.structure.tryCreateComponentFromExpression(
      structure, MS.struct.generator.atomGroups({}), 'homolog-all', { label: 'Homolog' }
    )
    if (component) {
      await plugin.builders.structure.representation.addRepresentation(component, {
        type: 'cartoon',
        color: 'uniform',
        colorParams: { value: Color(0x88aaff) },
        typeParams: { alpha: 0.7 },
      })
    }
  } catch (err) {
    console.warn('Superimpose load failed:', err)
  }
}

async function removeSuperimpose(plugin, ref) {
  try {
    if (!ref.current) return
    const cell = plugin.state.data.cells.get(ref.current.data)
    if (cell) {
      const update = plugin.state.data.build().delete(ref.current.data)
      await update.commit()
    }
    ref.current = null
  } catch (err) {
    console.warn('Superimpose remove failed:', err)
  }
}

// ── pLDDT coloring ────────────────────────────────────────────────────

async function registerPlddtTheme(plugin) {
  try {
    const { CustomElementProperty } = await import(
      'molstar/lib/commonjs/mol-model-props/common/custom-element-property'
    )
    const { Color } = await import('molstar/lib/commonjs/mol-util/color')

    const CustomPlddt = CustomElementProperty.create({
      label: 'Custom pLDDT Confidence',
      name: 'custom-plddt-confidence',
      getData(model) {
        const map = new Map()
        if (model.atomicConformation?.B_iso_or_equiv) {
          const bFactors = model.atomicConformation.B_iso_or_equiv.value
          for (let i = 0, n = model.atomicHierarchy.atoms._rowCount; i < n; i++) {
            map.set(i, bFactors(i))
          }
        }
        return { value: map }
      },
      coloring: {
        getColor(v) {
          if (v > 90) return Color(0x0066cc)
          if (v > 70) return Color(0x4dd8e8)
          if (v > 50) return Color(0xffdd57)
          return Color(0xff9933)
        },
        defaultColor: Color(0x999999),
      },
      getLabel(v) {
        if (v > 90) return 'Very High (>90)'
        if (v > 70) return 'Confident (70-90)'
        if (v > 50) return 'Low (50-70)'
        return 'Very Low (<50)'
      },
    })

    plddtThemeName = CustomPlddt.colorThemeProvider?.name
    if (CustomPlddt.colorThemeProvider) {
      plugin.representation.structure.themes.colorThemeRegistry.add(CustomPlddt.colorThemeProvider)
    }
    if (CustomPlddt.propertyProvider) {
      plugin.customModelProperties.register(CustomPlddt.propertyProvider, true)
    }
  } catch (err) {
    console.warn('pLDDT theme registration failed:', err)
  }
}

async function registerElectrostaticTheme(plugin) {
  try {
    const { CustomElementProperty } = await import(
      'molstar/lib/commonjs/mol-model-props/common/custom-element-property'
    )
    const { Color } = await import('molstar/lib/commonjs/mol-util/color')

    const RESIDUE_CHARGE = {
      ARG: 1.0, LYS: 1.0, HIS: 0.5,
      ASP: -1.0, GLU: -1.0,
      ASN: -0.3, GLN: -0.3,
      SER: -0.15, THR: -0.15, TYR: -0.2, CYS: -0.2,
      ALA: 0, VAL: 0, LEU: 0, ILE: 0,
      PHE: 0, TRP: 0.05, MET: 0, PRO: 0, GLY: 0,
    }

    const CustomElectrostatic = CustomElementProperty.create({
      label: 'Electrostatic Potential',
      name: 'custom-electrostatic-potential',
      getData(model) {
        const map = new Map()
        const n = model.atomicHierarchy.atoms._rowCount
        const compId = model.atomicHierarchy.atoms.label_comp_id
        for (let i = 0; i < n; i++) {
          map.set(i, RESIDUE_CHARGE[compId.value(i)] ?? 0)
        }
        return { value: map }
      },
      coloring: {
        getColor(v) {
          const c = Math.max(-1, Math.min(1, v))
          let r, g, b
          if (c < 0) {
            const t = 1 + c
            r = Math.round(0xe7 + (0xff - 0xe7) * t)
            g = Math.round(0x4c + (0xff - 0x4c) * t)
            b = Math.round(0x3c + (0xff - 0x3c) * t)
          } else {
            r = Math.round(0xff - (0xff - 0x34) * c)
            g = Math.round(0xff - (0xff - 0x98) * c)
            b = Math.round(0xff - (0xff - 0xdb) * c)
          }
          return Color((r << 16) | (g << 8) | b)
        },
        defaultColor: Color(0xffffff),
      },
      getLabel(v) {
        if (v > 0.5) return 'Positive'
        if (v > 0.1) return 'Slightly positive'
        if (v > -0.1) return 'Neutral'
        if (v > -0.5) return 'Slightly negative'
        return 'Negative'
      },
    })

    electrostaticThemeName = CustomElectrostatic.colorThemeProvider?.name
    if (CustomElectrostatic.colorThemeProvider) {
      plugin.representation.structure.themes.colorThemeRegistry.add(CustomElectrostatic.colorThemeProvider)
    }
    if (CustomElectrostatic.propertyProvider) {
      plugin.customModelProperties.register(CustomElectrostatic.propertyProvider, true)
    }
  } catch (err) {
    console.warn('Electrostatic theme registration failed:', err)
  }
}

async function applyColoring(plugin, colorMode = 'plddt') {
  try {
    const themeName = colorMode === 'electrostatic' ? electrostaticThemeName : plddtThemeName
    if (!themeName) return
    await plugin.dataTransaction(async () => {
      for (const s of plugin.managers.structure.hierarchy.current.structures) {
        await plugin.managers.structure.component.updateRepresentationsTheme(
          s.components, { color: themeName }
        )
      }
    })
  } catch (err) {
    console.warn('Coloring failed:', err)
  }
}
