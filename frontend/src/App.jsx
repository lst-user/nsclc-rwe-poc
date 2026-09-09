import { useState } from 'react'
import CohortLandscape from './views/CohortLandscape'
import PatientTrajectory from './views/PatientTrajectory'
import MechanismStrategy from './views/MechanismStrategy'

const PERSONAS = [
  { id: 'epi', label: 'Epidemiology / RWE', short: 'Epi / RWE', defaultView: 'cohort-landscape' },
  { id: 'transmed', label: 'Translational Medicine', short: 'Trans Med', defaultView: 'patient-trajectory' },
  {
    id: 'medaffairs',
    label: 'Medical Affairs / Clinical Development',
    short: 'Med Affairs',
    defaultView: 'mechanism-strategy',
  },
]

// Full literal class names so Tailwind's content scanner can find them even
// though they're selected dynamically at runtime.
const PERSONA_DOT_CLASS = {
  epi: 'bg-epi-600',
  transmed: 'bg-transmed-600',
  medaffairs: 'bg-medaffairs-600',
}

const VIEWS = [
  { id: 'cohort-landscape', label: 'Cohort Landscape', Component: CohortLandscape },
  { id: 'patient-trajectory', label: 'Patient Trajectory', Component: PatientTrajectory },
  { id: 'mechanism-strategy', label: 'Mechanism & Strategy', Component: MechanismStrategy },
]

function App() {
  const [activePersona, setActivePersona] = useState(PERSONAS[0].id)
  const [activeView, setActiveView] = useState(PERSONAS[0].defaultView)

  function handlePersonaChange(personaId) {
    setActivePersona(personaId)
    const persona = PERSONAS.find((p) => p.id === personaId)
    if (persona) setActiveView(persona.defaultView)
  }

  return (
    <div className="min-h-svh bg-ink-50 font-sans text-ink-950">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-lg font-semibold tracking-tight">Resistance Atlas</h1>
            <span className="text-xs font-medium text-ink-400">PDAC · daraxonrasib RWE</span>
          </div>

          <div
            role="radiogroup"
            aria-label="Viewing as"
            className="flex items-center gap-1 rounded-full border border-ink-200 bg-ink-50 p-1"
          >
            {PERSONAS.map((persona) => {
              const isActive = persona.id === activePersona
              return (
                <button
                  key={persona.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => handlePersonaChange(persona.id)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 ${
                    isActive ? 'bg-white text-ink-950 shadow-sm' : 'text-ink-500 hover:text-ink-800'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${PERSONA_DOT_CLASS[persona.id]} ${isActive ? '' : 'opacity-40'}`}
                    aria-hidden="true"
                  />
                  {persona.short}
                </button>
              )
            })}
          </div>
        </div>
      </header>

      <nav className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-7xl gap-6 overflow-x-auto px-6">
          {VIEWS.map((view) => {
            const isActive = view.id === activeView
            return (
              <button
                key={view.id}
                type="button"
                onClick={() => setActiveView(view.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative shrink-0 py-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 ${
                  isActive ? 'text-ink-950' : 'text-ink-500 hover:text-ink-800'
                }`}
              >
                {view.label}
                {isActive && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent-600" />}
              </button>
            )
          })}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {VIEWS.map((view) => (
          <div key={view.id} hidden={view.id !== activeView}>
            <view.Component />
          </div>
        ))}
      </main>
    </div>
  )
}

export default App
