// Each entry in `options` is either a plain string (used as both value and
// label) or a { value, label } pair for options whose display text differs
// from their filter value.
function FilterSelect({ label, value, options, onChange, allLabel = 'All' }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wide text-ink-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-sm text-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
      >
        <option value="all">{allLabel}</option>
        {options.map((option) => {
          const optionValue = typeof option === 'string' ? option : option.value
          const optionLabel = typeof option === 'string' ? option : option.label
          return (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          )
        })}
      </select>
    </label>
  )
}

export default FilterSelect
