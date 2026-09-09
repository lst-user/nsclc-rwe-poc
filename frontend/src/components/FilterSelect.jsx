function FilterSelect({ label, value, options, onChange }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wide text-ink-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-sm text-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
      >
        <option value="all">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

export default FilterSelect
