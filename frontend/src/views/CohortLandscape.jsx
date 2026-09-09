import { useCohort } from '../data/useCohort'

function StatTile({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold text-ink-950">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
    </div>
  )
}

function CohortLandscape() {
  const { stats } = useCohort()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink-950">Cohort Landscape</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">
          Population-level view for Epidemiology / RWE — dose-response, resistance rates, and mechanism
          distribution across the trial cohort.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Patients" value={stats.total} />
        <StatTile
          label="Resistance rate"
          value={`${(stats.resistanceRate * 100).toFixed(1)}%`}
          sub={`${stats.resistantCount} of ${stats.total}`}
        />
        <StatTile
          label="Tissue/ctDNA concordance"
          value={`${(stats.tissueCtdnaConcordanceRate * 100).toFixed(1)}%`}
          sub={`${stats.tissueCtdnaConcordantCount} of ${stats.total}`}
        />
        <StatTile
          label="Resistance mechanisms"
          value={Object.keys(stats.mechanismCounts).length}
          sub="distinct mechanisms observed"
        />
      </div>

      <div className="rounded-lg border border-dashed border-ink-200 bg-white px-5 py-4 text-sm text-ink-500">
        Next up here: dose-band resistance-rate comparison, mechanism-breakdown chart, TP53/KRASamp
        association, and PFS distribution by best response — all driven by{' '}
        <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-xs text-ink-800">useCohort()</code>.
      </div>
    </div>
  )
}

export default CohortLandscape
