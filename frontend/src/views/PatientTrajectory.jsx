import { useCohort } from '../data/useCohort'

function PatientTrajectory() {
  const { cohort } = useCohort()
  const preview = cohort.slice(0, 6)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink-950">Patient Trajectory</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">
          Individual-patient view for Translational Medicine — the full longitudinal timeline across
          clinical, imaging, laboratory, and multi-omic assays for one selected patient, from enrollment
          through daraxonrasib initiation to acquired resistance.
        </p>
      </div>

      <div className="rounded-lg border border-ink-200 bg-white p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
          Select a patient ({cohort.length} available)
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {preview.map((patient) => (
            <span
              key={patient.patientId}
              className="rounded-full border border-ink-200 bg-ink-50 px-3 py-1 font-mono text-xs text-ink-800"
            >
              {patient.patientId}
            </span>
          ))}
          <span className="px-3 py-1 text-xs text-ink-400">+{cohort.length - preview.length} more</span>
        </div>
      </div>

      <div className="rounded-lg border border-dashed border-ink-200 bg-white px-5 py-4 text-sm text-ink-500">
        Next up here: a patient picker driving the swimlane event timeline (Line of Therapy → Clinical →
        Imaging → Laboratory → Genomics → Deep Sequencing → Transcriptomics → Epigenomics → Flow
        Cytometry → Digital Pathology → Phospho-proteomics), matching the pattern already prototyped for
        PDAC-039.
      </div>
    </div>
  )
}

export default PatientTrajectory
