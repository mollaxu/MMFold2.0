const SEARCH_URL = 'https://search.rcsb.org/rcsbsearch/v2/query'
const DATA_URL   = 'https://data.rcsb.org/rest/v1/core'

export async function fetchHomologs(sequence, limit = 5) {
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: {
        type: 'terminal',
        service: 'sequence',
        parameters: {
          evalue_cutoff: 1,
          identity_cutoff: 0.3,
          sequence_type: 'protein',
          value: sequence,
        },
      },
      result_type: 'polymer_entity',
      limit: limit + 1,
      request_options: {
        scoring_strategy: 'sequence',
        results_verbosity: 'verbose',
      },
    }),
  })

  if (!res.ok) throw new Error(`RCSB search failed: ${res.status}`)
  const data = await res.json()
  const hits = (data.result_set ?? []).slice(0, limit)

  return Promise.all(hits.map(async hit => {
    const [pdbId, entityId] = hit.identifier.split('_')
    const ctx = hit.services?.[0]?.nodes?.[0]?.match_context?.[0]
    const identity = ctx?.sequence_identity ?? null
    const evalue   = ctx?.evalue ?? null

    try {
      const [entryRes, entityRes] = await Promise.all([
        fetch(`${DATA_URL}/entry/${pdbId}`),
        fetch(`${DATA_URL}/polymer_entity/${pdbId}/${entityId}`),
      ])
      const entry  = entryRes.ok  ? await entryRes.json()  : {}
      const entity = entityRes.ok ? await entityRes.json() : {}

      return {
        pdbId,
        title:      entry.struct?.title ?? 'Unknown',
        resolution: entry.rcsb_entry_info?.resolution_combined?.[0] ?? null,
        organism:   entity.rcsb_entity_source_organism?.[0]?.ncbi_scientific_name ?? 'Unknown',
        identity:   identity != null ? Math.round(identity * 100) : null,
        evalue:     evalue   != null ? evalue.toExponential(1)    : null,
      }
    } catch {
      return { pdbId, title: 'Unknown', resolution: null, organism: 'Unknown',
               identity: identity != null ? Math.round(identity * 100) : null,
               evalue: evalue != null ? evalue.toExponential(1) : null }
    }
  }))
}
