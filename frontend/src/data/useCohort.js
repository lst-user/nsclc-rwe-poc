import { useMemo } from 'react'
import cohort from './cohort.json'

/**
 * Computes basic cohort-level derived stats from a list of patient records.
 * Pure and React-independent, so it works on the full cohort or any slice of
 * it, e.g. selectCohortStats(cohort.filter((p) => p.doseBand === '160-300mg')).
 * @param {import('./types.js').Cohort} patients
 */
export function selectCohortStats(patients) {
  const total = patients.length
  const resistant = patients.filter((p) => p.hasAcquiredResistance)
  const resistantCount = resistant.length

  const mechanismCounts = {}
  for (const p of resistant) {
    mechanismCounts[p.resistanceMechanism] = (mechanismCounts[p.resistanceMechanism] || 0) + 1
  }

  const tissueCtdnaConcordantCount = patients.filter(
    (p) => p.genomics.progression.repeatBiopsyNGS.tissueCtdnaConcordant,
  ).length

  return {
    total,
    resistantCount,
    resistanceRate: total === 0 ? 0 : resistantCount / total,
    mechanismCounts,
    tissueCtdnaConcordantCount,
    tissueCtdnaConcordanceRate: total === 0 ? 0 : tissueCtdnaConcordantCount / total,
  }
}

// The cohort is a static build-time import, so stats only need computing once.
const stats = selectCohortStats(cohort)

/**
 * Loads the synthetic PDAC cohort and exposes it alongside basic derived
 * stats (resistance rate, mechanism counts, tissue/ctDNA concordance).
 * @returns {{ cohort: import('./types.js').Cohort, stats: ReturnType<typeof selectCohortStats> }}
 */
export function useCohort() {
  return useMemo(() => ({ cohort, stats }), [])
}
