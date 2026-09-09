import { useMemo } from 'react'
import { useCohort } from '../data/useCohort'

const KNOWN_GROUP_IDS = ['KRASamp', 'MAPK-RAF', 'RTK', 'PI3K']

const MECHANISM_GROUPS = [
  {
    id: 'KRASamp',
    label: 'KRASamp',
    rationale: 'KRAS copy-number gain restores oncogenic RAS-pathway signaling despite RAS(ON) inhibition.',
  },
  {
    id: 'MAPK-RAF',
    label: 'MAPK / RAF',
    rationale: 'Reactivation through the parallel RAF–MEK–ERK node bypasses RAS(ON) blockade downstream.',
  },
  {
    id: 'RTK',
    label: 'RTK',
    rationale: 'Upregulated receptor tyrosine kinase signaling (e.g., HER2) opens an alternate route around RAS pathway blockade.',
  },
  {
    id: 'PI3K',
    label: 'PI3K',
    rationale: 'Parallel PI3K/AKT/mTOR pathway activation sustains proliferative signaling independent of RAS(ON) inhibition.',
  },
  {
    id: 'Other',
    label: 'Other',
    rationale: 'Individually rare mechanisms — including PPIA, a non-panel alteration only high-depth WES/WGS recovers.',
  },
]

function groupIdOf(mechanism) {
  return KNOWN_GROUP_IDS.includes(mechanism) ? mechanism : 'Other'
}

function MechanismCard({ group, isActive, cohortTotal, resistantTotal, krasampTp53 }) {
  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        isActive ? 'border-accent-600 bg-accent-50 ring-1 ring-accent-600' : 'border-ink-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-semibold text-ink-950">{group.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">{group.rationale}</p>
        </div>
        {isActive && (
          <span className="shrink-0 rounded-full bg-accent-600 px-2 py-0.5 text-[10px] font-semibold text-white">
            Active
          </span>
        )}
      </div>

      <div className="mt-4 flex items-end gap-5">
        <div>
          <p className="font-mono text-2xl font-semibold text-ink-950">{(group.pctOfCohort * 100).toFixed(1)}%</p>
          <p className="text-[11px] text-ink-400">
            of cohort ({group.count} of {cohortTotal})
          </p>
        </div>
        <div>
          <p className="font-mono text-lg font-semibold text-ink-700">{(group.pctOfResistant * 100).toFixed(1)}%</p>
          <p className="text-[11px] text-ink-400">
            of resistance-positive ({group.count} of {resistantTotal})
          </p>
        </div>
      </div>

      {group.count === 0 ? (
        <p className="mt-4 text-xs text-ink-400">No patients currently show this mechanism.</p>
      ) : (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Combination strategy</p>
          <ul className="mt-1 space-y-0.5 text-sm text-ink-800">
            {group.strategies.map(([strategy, count]) => (
              <li key={strategy}>
                <span className="font-mono font-semibold">{count}</span> · {strategy}
              </li>
            ))}
          </ul>
        </div>
      )}

      {group.id === 'Other' && group.subMechanisms.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Includes</p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-ink-600">
            {group.subMechanisms.map(([mechanism, count]) => (
              <span key={mechanism}>
                {mechanism} · {count}
              </span>
            ))}
          </p>
        </div>
      )}

      {krasampTp53 && krasampTp53.total > 0 && (
        <div className="mt-3 rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-700">
          <span className="font-mono font-semibold">{krasampTp53.mutant}</span> of{' '}
          <span className="font-mono font-semibold">{krasampTp53.total}</span> KRASamp patients are TP53-mutant,
          routing <span className="font-mono font-semibold">{krasampTp53.onDDR}</span> to DDR combo — TP53 loss
          creates replication stress vulnerability exploitable by DDR inhibition.
        </div>
      )}
    </div>
  )
}

// mechanismFilter/selectedPatientId are lifted to App.jsx so a mechanism
// picked in Cohort Landscape, or implied by whichever patient is open in
// Patient Trajectory, highlights the matching card here.
function MechanismStrategy({ mechanismFilter, selectedPatientId }) {
  const { cohort } = useCohort()

  const resistant = useMemo(() => cohort.filter((p) => p.hasAcquiredResistance), [cohort])

  const selectedPatient = useMemo(
    () => cohort.find((p) => p.patientId === selectedPatientId) ?? null,
    [cohort, selectedPatientId],
  )
  const activeMechanism =
    mechanismFilter ?? (selectedPatient?.hasAcquiredResistance ? selectedPatient.resistanceMechanism : null)
  const activeGroupId = activeMechanism ? groupIdOf(activeMechanism) : null

  const groups = useMemo(
    () =>
      MECHANISM_GROUPS.map((group) => {
        const patients = resistant.filter((p) => groupIdOf(p.resistanceMechanism) === group.id)
        const strategyCounts = {}
        const mechanismCounts = {}
        for (const p of patients) {
          strategyCounts[p.combinationStrategy] = (strategyCounts[p.combinationStrategy] || 0) + 1
          mechanismCounts[p.resistanceMechanism] = (mechanismCounts[p.resistanceMechanism] || 0) + 1
        }
        return {
          ...group,
          count: patients.length,
          pctOfCohort: cohort.length ? patients.length / cohort.length : 0,
          pctOfResistant: resistant.length ? patients.length / resistant.length : 0,
          strategies: Object.entries(strategyCounts).sort((a, b) => b[1] - a[1]),
          subMechanisms: Object.entries(mechanismCounts).sort((a, b) => b[1] - a[1]),
        }
      }),
    [cohort, resistant],
  )

  // KRASamp-specific TP53 split, surfacing the DDR-eligibility rationale
  // (TP53-mutant KRASamp patients are routed to DDR combo — see
  // generateCohort.js's combinationStrategy rule).
  const krasampTp53 = useMemo(() => {
    const krasampPatients = resistant.filter((p) => p.resistanceMechanism === 'KRASamp')
    const mutant = krasampPatients.filter(
      (p) => p.genomics.baseline.diagnosticBiopsyNGS.pretreatmentTP53Status === 'mutant',
    )
    const onDDR = mutant.filter((p) => p.combinationStrategy?.startsWith('DDR')).length
    return { total: krasampPatients.length, mutant: mutant.length, onDDR }
  }, [resistant])

  return (
    <div className="space-y-6">
      <ViewHeader />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {groups.map((group) => (
          <MechanismCard
            key={group.id}
            group={group}
            isActive={group.id === activeGroupId}
            cohortTotal={cohort.length}
            resistantTotal={resistant.length}
            krasampTp53={group.id === 'KRASamp' ? krasampTp53 : null}
          />
        ))}
      </div>

      <div className="rounded-lg border border-ink-200 bg-white px-5 py-4 text-xs text-ink-500">
        Patients with a pathogenic germline BRCA1/2 variant are routed to DDR inhibitor combination
        regardless of resistance mechanism — that override takes priority over every mechanism-specific
        rule above, so each card&rsquo;s strategy breakdown reflects the mix actually observed for that
        group rather than a single fixed assignment.
      </div>
    </div>
  )
}

function ViewHeader() {
  return (
    <div>
      <h2 className="text-lg font-semibold text-ink-950">Mechanism &amp; Strategy</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-600">
        Actionable view for Medical Affairs / Clinical Development — resistance-mechanism breakdown mapped
        to combination-strategy recommendations, with the rationale behind each.
      </p>
    </div>
  )
}

export default MechanismStrategy
