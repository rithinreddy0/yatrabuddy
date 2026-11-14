import React, {useEffect, useMemo, useState} from 'react'
import {request} from '../api.mjs'
import {Button, Icon, IconButton, Pill} from '../components/UI.jsx'
import {money} from '../planner.mjs'
import {LEDGER_CATEGORIES, budgetSummaryText, emptyLedger, ledgerCsv, rupees, settlement, statusLabel, summarizeBudget} from './budgetLedger.mjs'
import './TripBudget.css'

const today = () => new Date().toISOString().slice(0, 10)

function tripPhase(draft) {
  if (!draft.departure) return 'before'
  const start = new Date(draft.departure + 'T00:00:00Z')
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + draft.days.length)
  const now = new Date(today() + 'T00:00:00Z')
  return now < start ? 'before' : now < end ? 'during' : 'after'
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], {type}))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Tile({label, value, hint, tone}) {
  return <div className="trip-budget-tile" data-tone={tone}>
    <small>{label}</small><strong>{value}</strong>{hint && <span>{hint}</span>}
  </div>
}

function ExpenseForm({ledger, bookings, onAdd, busy}) {
  const [kind, setKind] = useState('expense')
  const [split, setSplit] = useState(ledger.members)
  const [bookingId, setBookingId] = useState('')
  const linkable = bookings.filter(booking => booking.status === 'confirmed' &&
    !ledger.expenses.some(expense => expense.bookingId === booking.id))
  useEffect(() => setSplit(ledger.members), [ledger.members])
  function submit(event) {
    event.preventDefault()
    const element = event.currentTarget
    const form = new FormData(element)
    const booking = bookings.find(item => item.id === bookingId)
    const payer = form.get('payer') || null
    onAdd({
      id:crypto.randomUUID(), kind, category:form.get('category'), amount:Number(form.get('amount')),
      date:form.get('date') || null, note:String(form.get('note') || '').trim().slice(0, 200), payer,
      split:ledger.members.length && split.length !== ledger.members.length ? split : [],
      bookingId:booking?.id || null,
    }).then(saved => { if (saved) { element.reset(); setBookingId('') } })
  }
  const linked = bookings.find(item => item.id === bookingId)
  return <form className="trip-budget-form" onSubmit={submit} aria-label="Record an expense">
    <div className="trip-budget-kind" role="group" aria-label="Entry type">
      <Pill active={kind === 'expense'} onClick={() => setKind('expense')}>Expense</Pill>
      <Pill active={kind === 'refund'} onClick={() => setKind('refund')}>Refund received</Pill>
    </div>
    {linkable.length > 0 && kind === 'expense' && <label className="trip-budget-wide">Pays for a confirmed booking (optional)
      <select value={bookingId} onChange={event => setBookingId(event.target.value)}>
        <option value="">Not linked to a booking</option>
        {linkable.map(booking => <option key={booking.id} value={booking.id}>{booking.title}{booking.amount != null ? ' · ' + money(booking.amount) : ''}</option>)}
      </select>
    </label>}
    <label>Amount (₹)<input name="amount" type="number" required min={1} max={10000000} step={1} key={'a' + bookingId}
      defaultValue={linked?.amount ?? ''}/></label>
    <label>Category<select name="category" key={'c' + bookingId} defaultValue={linked ? {Flight:'Transport', Train:'Transport', Bus:'Transport',
      Stay:'Stay', Activity:'Attractions', 'Car or cab':'Local travel'}[linked.bookingType] || 'Miscellaneous' : 'Food'}>
      {LEDGER_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></label>
    <label>Date<input name="date" type="date" defaultValue={today()}/></label>
    {ledger.members.length > 0 && <label>{kind === 'refund' ? 'Received by' : 'Paid by'}<select name="payer" required>
      {ledger.members.map(name => <option key={name}>{name}</option>)}</select></label>}
    {ledger.members.length > 1 && <fieldset className="trip-budget-wide"><legend>Shared by</legend>
      <div className="trip-budget-pills">{ledger.members.map(name => <Pill key={name} active={split.includes(name)}
        onClick={() => setSplit(current => current.includes(name) ? current.filter(item => item !== name) : [...current, name])}>{name}</Pill>)}</div>
    </fieldset>}
    <label className="trip-budget-wide">Note<input name="note" maxLength={200} key={'n' + bookingId} defaultValue={linked?.title || ''}
      placeholder={kind === 'refund' ? 'What was refunded' : 'Lunch at the beach shack, auto fare…'}/></label>
    <Button type="submit" variant="primary" icon="plus" disabled={busy || (ledger.members.length > 1 && !split.length)}>
      {kind === 'refund' ? 'Add refund' : 'Add expense'}</Button>
  </form>
}

function PlanForm({draft, ledger, onSave, busy, onClose}) {
  const [error, setError] = useState('')
  function submit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const categoryBudgets = {}
    for (const category of LEDGER_CATEGORIES) {
      const value = form.get(category)
      if (value !== '') categoryBudgets[category] = Number(value)
    }
    const total = form.get('total')
    const members = String(form.get('members') || '').split(',').map(name => name.trim().slice(0, 40)).filter(Boolean)
    const unique = [...new Map(members.map(name => [name.toLocaleLowerCase(), name])).values()].slice(0, 8)
    const removed = ledger.members.filter(name => !unique.includes(name))
    const used = removed.filter(name => ledger.expenses.some(expense => expense.payer === name || expense.split?.includes(name)))
    if (used.length) {
      setError(`${used.join(', ')} already ${used.length === 1 ? 'appears' : 'appear'} in expenses. Remove those expenses first.`)
      return
    }
    onSave({budget:total ? Number(total) : null, ledger:{...ledger, categoryBudgets, members:unique,
      contingency:Number(form.get('contingency') || 0)}}).then(saved => saved && onClose())
  }
  return <form className="trip-budget-form" onSubmit={submit} aria-label="Plan the budget">
    <label>Total group budget (₹)<input name="total" type="number" min={1000} max={10000000} step={1} defaultValue={draft.budget ?? ''}/></label>
    <label>Emergency reserve (₹)<input name="contingency" type="number" min={0} max={10000000} step={1} defaultValue={ledger.contingency || ''}/></label>
    <label className="trip-budget-wide">Travellers sharing costs <small>Comma separated, up to 8. Needed to split expenses.</small>
      <input name="members" maxLength={340} defaultValue={ledger.members.join(', ')} placeholder="Asha, Ravi, Meena"/></label>
    <fieldset className="trip-budget-wide"><legend>Category budgets (₹, optional)</legend>
      <div className="trip-budget-category-inputs">{LEDGER_CATEGORIES.map(category => <label key={category}>{category}
        <input name={category} type="number" min={0} max={10000000} step={1} defaultValue={ledger.categoryBudgets[category] ?? ''}/></label>)}</div>
    </fieldset>
    {error && <p className="form-error trip-budget-wide" role="alert">{error}</p>}
    <div className="trip-budget-actions"><Button onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="submit" variant="primary" icon="check" disabled={busy}>{busy ? 'Saving…' : 'Save budget plan'}</Button></div>
  </form>
}

export function TripBudget({draft, onSave, onOpenBookings}) {
  const ledger = {...emptyLedger(), ...(draft.ledger || {})}
  const [bookings, setBookings] = useState({loading:true, items:[]})
  const [planning, setPlanning] = useState(!draft.ledger && draft.budget == null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [filter, setFilter] = useState('')
  const phase = tripPhase(draft)

  useEffect(() => {
    const controller = new AbortController()
    request('trip-workspaces', {method:'POST', body:draft, signal:controller.signal})
      .then(room => { if (!controller.signal.aborted) setBookings({items:room.entries.filter(entry => entry.kind === 'booking')}) })
      .catch(error => { if (!controller.signal.aborted) setBookings({items:[], error:error.message}) })
    return () => controller.abort()
  // Bookings only change from the Bookings section, so reload when the trip identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id])

  const summary = useMemo(() => summarizeBudget(draft, bookings.items), [draft, bookings.items])
  const transfers = useMemo(() => settlement(ledger), [draft.ledger])
  const unloggedRefunds = bookings.items.filter(booking => booking.refundAmount > 0 &&
    !ledger.expenses.some(expense => expense.kind === 'refund' && expense.bookingId === booking.id))

  async function save(changes, message) {
    setBusy(true)
    setStatus('')
    try {
      await onSave({...draft, ...changes, updated:Math.max(Date.now(), draft.updated + 1)})
      setStatus(message)
      return true
    } catch (error) {
      setStatus(error.message || 'The budget could not be saved. Try again.')
      return false
    } finally {
      setBusy(false)
    }
  }
  const addExpense = expense => save({ledger:{...ledger, expenses:[expense, ...ledger.expenses].slice(0, 150)}},
    expense.kind === 'refund' ? 'Refund recorded.' : 'Expense recorded.')
  const removeExpense = id => save({ledger:{...ledger, expenses:ledger.expenses.filter(item => item.id !== id)}}, 'Entry removed.')
  const shown = ledger.expenses.filter(expense => !filter || expense.category === filter)
    .slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  const used = summary.total ? Math.round(100 * summary.spent / summary.total) : null
  const format = value => money(value)

  return <section className="trip-overview-glass trip-overview-section trip-budget" aria-label="Trip budget">
    <div className="trip-overview-section-head">
      <div><h2>{phase === 'before' ? 'Before your trip' : phase === 'during' ? 'During your trip' : 'After your trip'}</h2>
        <p>{phase === 'before' ? 'Plan category budgets, then log spending during the trip.' : phase === 'during'
          ? 'Log what you spend as you go. Remaining amounts update straight away.' : 'Final spend, variance and who owes whom.'}</p></div>
      <Icon name="wallet" size={23}/>
    </div>

    <div className="trip-budget-tiles">
      <Tile label="Total budget" value={summary.total == null ? 'Not set' : format(summary.total)}
        hint={summary.contingency ? format(summary.contingency) + ' kept in reserve' : null}/>
      <Tile label="Expected trip cost" value={format(summary.spent + summary.remainingCosts)} hint="Spent + still to pay"/>
      <Tile label={phase === 'after' ? 'Final spend' : 'Spent so far'} value={format(summary.spent)} hint="Logged expenses minus refunds"/>
      <Tile label="Remaining budget" value={summary.remainingBudget == null ? '—' : format(summary.remainingBudget)}
        tone={summary.remainingBudget < 0 ? 'over' : undefined}/>
      <Tile label="Still to pay (estimate)" value={format(summary.remainingCosts)}
        hint={summary.committed ? format(summary.committed) + ' in confirmed bookings' : null}/>
      <Tile label={phase === 'after' ? 'Budget variance' : 'Expected balance'} value={summary.finalBalance == null ? '—' :
        (summary.finalBalance < 0 ? '−' : '') + format(Math.abs(summary.finalBalance))}
        tone={summary.finalBalance < 0 ? 'over' : summary.finalBalance != null && summary.expected ? 'good' : undefined}
        hint={summary.finalBalance == null ? 'Set a total budget' : !summary.expected && !summary.spent ? 'Add a plan or expenses to forecast'
          : summary.finalBalance < 0 ? 'Over budget' : 'Under budget'}/>
    </div>
    {used != null && <progress className="trip-budget-progress" max={100} value={Math.min(used, 100)} aria-label={`${used}% of budget spent`}/>}

    {summary.warnings.length > 0 && <ul className="trip-budget-warnings" role="status">
      {summary.warnings.map(text => <li key={text}><Icon name="info" size={15}/>{text}</li>)}</ul>}
    {(summary.pendingBookings > 0 || summary.unknownBookings > 0) && <p className="trip-budget-note">
      {summary.pendingBookings > 0 && `${summary.pendingBookings} booking${summary.pendingBookings === 1 ? ' is' : 's are'} not confirmed yet and ${summary.pendingBookings === 1 ? 'is' : 'are'} not counted. `}
      {summary.unknownBookings > 0 && `${summary.unknownBookings} booking${summary.unknownBookings === 1 ? ' has' : 's have'} no status, so ${summary.unknownBookings === 1 ? 'it is' : 'they are'} not counted. `}
      {onOpenBookings && <Button variant="text-btn" onClick={onOpenBookings}>Review bookings</Button>}</p>}
    {bookings.error && <p className="trip-budget-note">Bookings could not be loaded, so confirmed bookings are not included: {bookings.error}</p>}
    {unloggedRefunds.map(booking => <p className="trip-budget-note" key={booking.id}>
      {booking.title} has a {money(booking.refundAmount)} refund that is not in your spending yet.{' '}
      <Button disabled={busy} onClick={() => addExpense({id:crypto.randomUUID(), kind:'refund', amount:booking.refundAmount,
        category:{Flight:'Transport', Train:'Transport', Bus:'Transport', Stay:'Stay', Activity:'Attractions', 'Car or cab':'Local travel'}[booking.bookingType] || 'Miscellaneous',
        date:today(), note:'Refund · ' + booking.title, payer:ledger.members[0] || null, split:[], bookingId:booking.id})}>Add refund</Button>
    </p>)}

    <div className="trip-budget-table-wrap">
      <table className="trip-budget-table">
        <caption>Planned and actual spending by category</caption>
        <thead><tr><th scope="col">Category</th><th scope="col">Budget</th><th scope="col">Spent</th><th scope="col">Booked</th><th scope="col">Expected</th></tr></thead>
        <tbody>{summary.categories.map(row => <tr key={row.category} data-over={row.over || undefined}>
          <th scope="row">{row.category}</th>
          <td>{row.budget != null ? format(row.budget) : row.estimate ? <span title="From entry costs on itinerary stops">{format(row.estimate)} est.</span> : '—'}</td>
          <td>{row.spent ? format(row.spent) : '—'}{row.refunds > 0 && <small> after {format(row.refunds)} refund</small>}</td>
          <td>{row.committed ? format(row.committed) : '—'}</td>
          <td>{row.expected ? format(row.expected) : '—'}{row.over && <small className="trip-budget-over"> over</small>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="trip-budget-note">“Booked” counts confirmed bookings that nobody has logged as paid yet, so a ticket is never counted twice.
      “Expected” is the larger of the plan and what is already spent or booked.</p>

    <div className="trip-budget-actions">
      <Button icon="edit" aria-expanded={planning} onClick={() => setPlanning(value => !value)}>{planning ? 'Close budget plan' : 'Edit budget plan'}</Button>
      <Button icon="download" disabled={!ledger.expenses.length} onClick={() => download((draft.name || 'trip') + '-expenses.csv', ledgerCsv(draft), 'text/csv;charset=utf-8')}>Export CSV</Button>
      <Button icon="link" onClick={async () => {
        const text = budgetSummaryText(draft, summary, transfers, format)
        try { await navigator.clipboard.writeText(text); setStatus('Budget summary copied.') } catch { setStatus('Copying is blocked in this browser.') }
      }}>Copy summary</Button>
    </div>
    {planning && <PlanForm key={draft.updated} draft={draft} ledger={ledger} busy={busy} onClose={() => setPlanning(false)}
      onSave={changes => save(changes, 'Budget plan saved.')}/>}

    <h3>Record spending</h3>
    {ledger.members.length === 0 && <p className="trip-budget-note">Add traveller names in the budget plan to split costs and see who owes whom.</p>}
    <ExpenseForm ledger={ledger} bookings={bookings.items} onAdd={addExpense} busy={busy}/>
    {status && <p className="trip-overview-status" role="status">{status}</p>}

    {ledger.expenses.length > 0 && <>
      <div className="trip-budget-list-head"><h3>Expenses <small>{ledger.expenses.length}</small></h3>
        <label>Show<select value={filter} onChange={event => setFilter(event.target.value)}><option value="">All categories</option>
          {LEDGER_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></label></div>
      <ul className="trip-budget-expenses">{shown.map(expense => {
        const booking = bookings.items.find(item => item.id === expense.bookingId)
        return <li key={expense.id} data-kind={expense.kind}>
          <div><strong>{expense.note || expense.category}</strong>
            <small>{[expense.date, expense.category, expense.payer && (expense.kind === 'refund' ? 'to ' : 'paid by ') + expense.payer,
              expense.split?.length ? 'shared by ' + expense.split.join(', ') : null, booking && 'booking: ' + booking.title + ' (' + statusLabel(booking.status) + ')']
              .filter(Boolean).join(' · ')}</small></div>
          <span className="trip-budget-amount">{expense.kind === 'refund' ? '−' : ''}{money(expense.amount)}</span>
          <IconButton icon="trash" label={'Remove ' + (expense.note || expense.category)} disabled={busy} onClick={() => removeExpense(expense.id)}/>
        </li>
      })}</ul>
    </>}

    {ledger.members.length > 1 && <section className="trip-budget-settle" aria-label="Settle up">
      <h3>Settle up</h3>
      {transfers.length ? <ul>{transfers.map(item => <li key={item.from + item.to}><strong>{item.from}</strong> pays <strong>{item.to}</strong> {rupees(item.paise)}</li>)}</ul>
        : <p>Everyone is even.</p>}
      <p className="trip-budget-note">Only expenses with a payer are included. YatraBuddy does not move money.</p>
    </section>}
  </section>
}
