import { useCohort } from '../data/useCohort'

function MechanismStrategy() {
  const { stats } = useCohort()
  const mechanisms = Object.entries(stats.mechanismCounts).sort((a, b) => b[1] - a[1])
  const maxCount = mechanisms.length > 0 ? mechanisms[0][1] : 1

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink-950">Mechanism &amp; Strategy</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">
          Actionable view for Medical Affairs / Clinical Development — resistance-mechanism breakdown
          mapped to combination-strategy recommendations (DDR inhibitor combination, RTK-targeted
          ADC/bispecific, RAS(ON) inhibitor doublet, or under investigation).
        </p>
      </div>

      <div className="rounded-lg border border-ink-200 bg-white p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
          Resistance mechanisms ({stats.resistantCount} resistance-positive patients)
        </p>
        <ul className="mt-3 space-y-2">
          {mechanisms.map(([mechanism, count]) => (
            <li key={mechanism} className="flex items-center gap-3">
              <span className="w-24 shrink-0 font-mono text-xs text-ink-800">{mechanism}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                <span
                  className="block h-full rounded-full bg-accent-600"
                  style={{ width: `${(count / maxCount) * 100}%` }}
                />
              </span>
              <span className="w-6 shrink-0 text-right font-mono text-xs text-ink-600">{count}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-dashed border-ink-200 bg-white px-5 py-4 text-sm text-ink-500">
        Next up here: per-mechanism combination-strategy cards, the TP53/KRASamp-driven DDR eligibility
        rule, and the PPIA panel-miss callout (the one mechanism only high-depth WES/WGS recovers).
      </div>
    </div>
  )
}

export default MechanismStrategy
