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
  interactions = null,
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
  const overlayRef = useRef(null)
  const ixElementsRef = useRef([])

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
        const { OrderedSet } = await import('molstar/lib/commonjs/mol-data/int')
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
          try {
            const loc = StructureElement.Location.create(loci.structure)
            loc.unit = e.unit
            loc.element = e.unit.elements[OrderedSet.getAt(e.indices, 0)]
            const chain = String(SP.chain.auth_asym_id(loc))
            const seqId = Number(SP.residue.auth_seq_id(loc))
            const resType = String(SP.atom.auth_comp_id(loc))
            if (!chain || !isFinite(seqId)) {
              clickFromStructureRef.current = true
              onResidueClickRef.current(null)
              return
            }
            clickFromStructureRef.current = true
            onResidueClickRef.current({ chain, seqId, resType })
          } catch {
            clickFromStructureRef.current = true
            onResidueClickRef.current(null)
          }
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

  // ── Interaction overlay (colored lines + distance labels) ──────────
  useEffect(() => {
    if (!structureReady || !pluginRef.current || !interactions) {
      clearInteractionOverlay(overlayRef, ixElementsRef)
      return
    }

    const plugin = pluginRef.current

    if (!focusedResidue) {
      clearInteractionOverlay(overlayRef, ixElementsRef)
      return
    }

    let cancelled = false
    ;(async () => {
      const ixItems = flattenInteractions(interactions, focusedResidue)
      if (!ixItems.length || cancelled) { clearInteractionOverlay(overlayRef, ixElementsRef); return }

      const coordsMap = await buildAtomCoordsMap(plugin, ixItems)
      if (cancelled) return

      const elements = createOverlayElements(overlayRef, ixItems, coordsMap)
      ixElementsRef.current = elements
      updateOverlayPositions(plugin, overlayRef, elements)
    })()

    let rafId = null
    const tick = () => {
      if (cancelled) return
      if (ixElementsRef.current.length) {
        updateOverlayPositions(pluginRef.current, overlayRef, ixElementsRef.current)
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      if (rafId) cancelAnimationFrame(rafId)
      clearInteractionOverlay(overlayRef, ixElementsRef)
    }
  }, [structureReady, focusedResidue, interactions])

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
      <svg
        ref={overlayRef}
        style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none', zIndex: 1,
          overflow: 'visible',
        }}
      />
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

// ── Interaction overlay helpers ──────────────────────────────────────

const IX_COLORS = {
  hBond: '#00cc66',
  piPi: '#ff8800',
  piCation: '#ffcc00',
  saltBridge: '#ff4444',
  hydrophobic: '#bb88ff',
}

const IX_LABELS = {
  hBond: 'H-Bond',
  piPi: 'π-π',
  piCation: 'π-Cat',
  saltBridge: 'Salt',
  hydrophobic: 'Hydro',
}

function flattenInteractions(interactions, focusedResidue, maxPerType = Infinity) {
  const result = []
  const match = (c, s) => !focusedResidue || (c === focusedResidue.chain && s === focusedResidue.seqId)

  const push = (type, items, maxN) => {
    let n = 0
    for (const item of items) {
      if (n >= maxN) break
      result.push({ type, ...item })
      n++
    }
  }

  const hBonds = (interactions?.hBonds ?? [])
    .filter(b => match(b.donorChain, b.donorPosition) || match(b.acceptorChain, b.acceptorPosition))
    .map(b => ({
      from: { chain: b.donorChain, resSeq: b.donorPosition, atom: b.donorAtom },
      to: { chain: b.acceptorChain, resSeq: b.acceptorPosition, atom: b.acceptorAtom },
      distance: b.distance,
    }))
  push('hBond', hBonds, maxPerType)

  const saltBridges = (interactions?.saltBridges ?? [])
    .filter(b => match(b.chain1, b.position1) || match(b.chain2, b.position2))
    .map(b => ({
      from: { chain: b.chain1, resSeq: b.position1, atom: b.atom1 },
      to: { chain: b.chain2, resSeq: b.position2, atom: b.atom2 },
      distance: b.distance,
    }))
  push('saltBridge', saltBridges, maxPerType)

  const hydrophobics = (interactions?.hydrophobics ?? [])
    .filter(b => match(b.chain1, b.position1) || match(b.chain2, b.position2))
    .map(b => ({
      from: { chain: b.chain1, resSeq: b.position1, atom: b.atom1 },
      to: { chain: b.chain2, resSeq: b.position2, atom: b.atom2 },
      distance: b.distance,
    }))
  push('hydrophobic', hydrophobics, maxPerType)

  const piPiStacks = (interactions?.piPiStacks ?? [])
    .filter(b => match(b.chain1, b.position1) || match(b.chain2, b.position2))
    .map(b => ({
      from: { chain: b.chain1, resSeq: b.position1, atom: 'CG' },
      to: { chain: b.chain2, resSeq: b.position2, atom: 'CG' },
      distance: b.distance,
    }))
  push('piPi', piPiStacks, maxPerType)

  const piCations = (interactions?.piCations ?? [])
    .filter(b => match(b.ringChain, b.ringPosition) || match(b.cationChain, b.cationPosition))
    .map(b => ({
      from: { chain: b.ringChain, resSeq: b.ringPosition, atom: 'CG' },
      to: { chain: b.cationChain, resSeq: b.cationPosition, atom: b.cationAtom },
      distance: b.distance,
    }))
  push('piCation', piCations, maxPerType)

  return result
}

async function buildAtomCoordsMap(plugin, ixItems) {
  const { StructureElement, StructureProperties: SP } = await import(
    'molstar/lib/commonjs/mol-model/structure'
  )
  const structure = plugin.managers.structure.hierarchy.current.structures[0]?.cell.obj?.data
  if (!structure) return new Map()

  const needed = new Set()
  for (const ix of ixItems) {
    needed.add(`${ix.from.chain}:${ix.from.resSeq}:${ix.from.atom}`)
    needed.add(`${ix.to.chain}:${ix.to.resSeq}:${ix.to.atom}`)
  }

  const coords = new Map()
  const fallbacks = new Map()

  for (const unit of structure.units) {
    const { elements } = unit
    const loc = StructureElement.Location.create(structure)
    loc.unit = unit
    for (let i = 0; i < elements.length; i++) {
      loc.element = elements[i]
      const c = String(SP.chain.auth_asym_id(loc))
      const r = Number(SP.residue.auth_seq_id(loc))
      const a = String(SP.atom.label_atom_id(loc))

      const key = `${c}:${r}:${a}`
      if (needed.has(key) && !coords.has(key)) {
        coords.set(key, {
          x: unit.conformation.x(elements[i]),
          y: unit.conformation.y(elements[i]),
          z: unit.conformation.z(elements[i]),
        })
      }

      const resKey = `${c}:${r}`
      if (!fallbacks.has(resKey)) {
        fallbacks.set(resKey, {
          x: unit.conformation.x(elements[i]),
          y: unit.conformation.y(elements[i]),
          z: unit.conformation.z(elements[i]),
        })
      }
    }
  }

  for (const key of needed) {
    if (!coords.has(key)) {
      const parts = key.split(':')
      const fb = fallbacks.get(`${parts[0]}:${parts[1]}`)
      if (fb) coords.set(key, fb)
    }
  }

  return coords
}

function worldToScreen(plugin, wx, wy, wz, sw, sh) {
  const cam = plugin.canvas3d?.camera
  if (!cam) return null

  const v = cam.view
  const p = cam.projection

  const ex = v[0] * wx + v[4] * wy + v[8] * wz + v[12]
  const ey = v[1] * wx + v[5] * wy + v[9] * wz + v[13]
  const ez = v[2] * wx + v[6] * wy + v[10] * wz + v[14]
  const ew = v[3] * wx + v[7] * wy + v[11] * wz + v[15]

  const cx = p[0] * ex + p[4] * ey + p[8] * ez + p[12] * ew
  const cy = p[1] * ex + p[5] * ey + p[9] * ez + p[13] * ew
  const cw = p[3] * ex + p[7] * ey + p[11] * ez + p[15] * ew

  if (cw <= 0.001) return null

  return {
    x: (cx / cw * 0.5 + 0.5) * sw,
    y: (1 - (cy / cw * 0.5 + 0.5)) * sh,
  }
}

function createOverlayElements(overlayRef, ixItems, coordsMap) {
  const svg = overlayRef.current
  if (!svg) return []

  const elements = []
  const NS = 'http://www.w3.org/2000/svg'

  const makeText = (content, color, fontSize = '10') => {
    const t = document.createElementNS(NS, 'text')
    t.setAttribute('fill', color)
    t.setAttribute('font-size', fontSize)
    t.setAttribute('font-family', 'monospace')
    t.setAttribute('text-anchor', 'middle')
    t.setAttribute('paint-order', 'stroke')
    t.setAttribute('stroke', '#000')
    t.setAttribute('stroke-width', '3')
    t.setAttribute('font-weight', 'bold')
    t.textContent = content
    svg.appendChild(t)
    return t
  }

  for (const ix of ixItems) {
    const fromKey = `${ix.from.chain}:${ix.from.resSeq}:${ix.from.atom}`
    const toKey = `${ix.to.chain}:${ix.to.resSeq}:${ix.to.atom}`
    const fromCoord = coordsMap.get(fromKey)
    const toCoord = coordsMap.get(toKey)
    if (!fromCoord || !toCoord) continue

    const color = IX_COLORS[ix.type] || '#ffffff'

    const line = document.createElementNS(NS, 'line')
    line.setAttribute('stroke', color)
    line.setAttribute('stroke-width', '1.5')
    line.setAttribute('stroke-dasharray', '4 3')
    line.setAttribute('opacity', '0.9')
    svg.appendChild(line)

    const distText = makeText(`${ix.distance.toFixed(1)}Å`, color, '10')
    const fromText = makeText(ix.from.atom, '#e0e0e0', '9')
    const toText = makeText(ix.to.atom, '#e0e0e0', '9')

    elements.push({ line, distText, fromText, toText, fromCoord, toCoord })
  }

  return elements
}

function updateOverlayPositions(plugin, overlayRef, elements) {
  const svg = overlayRef.current
  if (!svg || !elements.length || !plugin?.canvas3d) return

  const rect = svg.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`)

  for (const { line, distText, fromText, toText, fromCoord, toCoord } of elements) {
    const p1 = worldToScreen(plugin, fromCoord.x, fromCoord.y, fromCoord.z, rect.width, rect.height)
    const p2 = worldToScreen(plugin, toCoord.x, toCoord.y, toCoord.z, rect.width, rect.height)

    if (!p1 || !p2) {
      line.setAttribute('visibility', 'hidden')
      distText.setAttribute('visibility', 'hidden')
      fromText.setAttribute('visibility', 'hidden')
      toText.setAttribute('visibility', 'hidden')
      continue
    }

    line.setAttribute('visibility', 'visible')
    line.setAttribute('x1', p1.x)
    line.setAttribute('y1', p1.y)
    line.setAttribute('x2', p2.x)
    line.setAttribute('y2', p2.y)

    distText.setAttribute('visibility', 'visible')
    distText.setAttribute('x', (p1.x + p2.x) / 2)
    distText.setAttribute('y', (p1.y + p2.y) / 2 - 6)

    fromText.setAttribute('visibility', 'visible')
    fromText.setAttribute('x', p1.x)
    fromText.setAttribute('y', p1.y - 8)

    toText.setAttribute('visibility', 'visible')
    toText.setAttribute('x', p2.x)
    toText.setAttribute('y', p2.y - 8)
  }
}

function clearInteractionOverlay(overlayRef, ixElementsRef) {
  const svg = overlayRef.current
  if (svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild)
  }
  if (ixElementsRef) ixElementsRef.current = []
}
