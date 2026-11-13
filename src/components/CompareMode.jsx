import React from 'react'
import {Check, Award, X} from 'lucide-react'
import {Button} from './UI.jsx'
import {money} from '../planner.mjs'

export function CompareMode({comparison, onClear, onSelect}) {
  if (!comparison || comparison.items.length < 2) return null

  const {items, rows, bestPerRow} = comparison

  return (
    <div className="dynamic-compare-modal" role="region" aria-label="Option comparison">
      <div className="dynamic-compare-header">
        <h3>Side-by-side comparison</h3>
        <Button variant="outline" className="dynamic-compare-close" onClick={onClear} aria-label="Close comparison">
          <X size={16} /> Close
        </Button>
      </div>

      <div className="dynamic-compare-table-wrapper" tabIndex={0}>
        <table className="dynamic-compare-table">
          <caption>Comparing {items.length} options. Best value in each row is marked with an award badge.</caption>
          <thead>
            <tr>
              <th scope="col" className="dynamic-compare-row-header">Metric</th>
              {items.map(item => (
                <th key={item.id} scope="col" className="dynamic-compare-item-header">
                  <strong>{item.name}</strong>
                  {item.area && <small>{item.area}</small>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => {
              const bestColIdx = bestPerRow[rowIdx]
              return (
                <tr key={row.label}>
                  <th scope="row" className="dynamic-compare-row-label">{row.label}</th>
                  {row.values.map((val, colIdx) => {
                    const isBest = colIdx === bestColIdx && typeof val === 'number'
                    let displayVal = val
                    if (row.unit === 'currency' && typeof val === 'number') {
                      displayVal = money(val)
                    } else if (row.unit === 'minutes' && typeof val === 'number') {
                      displayVal = `${val} min`
                    }
                    return (
                      <td key={colIdx} className={isBest ? 'dynamic-compare-best' : ''}>
                        <div className="dynamic-compare-cell">
                          <span>{displayVal}</span>
                          {isBest && (
                            <span className="dynamic-best-badge" title="Best in this row">
                              <Award size={13} aria-hidden="true" />
                              <span className="yatra-sr-only">Best value</span>
                            </span>
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="dynamic-compare-actions">
        {items.map(item => (
          <Button
            key={item.id}
            variant="primary"
            onClick={() => {
              onSelect(item)
              onClear()
            }}
          >
            Select {item.name}
          </Button>
        ))}
      </div>
    </div>
  )
}
