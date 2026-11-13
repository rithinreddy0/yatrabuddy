import React, {useEffect, useRef, useState} from 'react'
import {ArrowLeft, ArrowUp, Check, Compass, Pencil, Sparkles} from 'lucide-react'
import {Brand, Button} from '../components/UI.jsx'
import {DestinationSearch} from '../components/DestinationSearch.jsx'
import {money} from '../planner.mjs'
import {defaultProfile, preferences} from '../profile.mjs'
import './OnboardingChat.css'

const travelerCounts = Array.from({length: 8}, (_, index) => index + 1)
const tripLengths = Array.from({length: 5}, (_, index) => index + 1)
const groupSizes = {Solo: 1, Couple: 2, Friends: 3, Family: 4}
const emptyChoices = new Set(['interests', 'stayPreferences'])
const questions = [
  {key: 'preferredName', label: 'Name', prompt: 'What should I call you?', kind: 'text', limit: 70,
    placeholder: 'Your preferred name', autocomplete: 'given-name'},
  {key: 'homeCity', label: 'Departure city', prompt: 'Which city do your trips usually start from?', kind: 'text',
    limit: 60, placeholder: 'City name'},
  {key: 'travelGroup', label: 'Travel group', prompt: 'Who do you usually travel with?', options: preferences.groups,
    format: value => value === 'Any' ? 'It varies' : value},
  {key: 'travelers', label: 'Travelers', prompt: 'How many people are usually in your group, including you?',
    options: travelerCounts, format: value => value === 1 ? '1 traveler' : `${value} travelers`},
  {key: 'tripDays', label: 'Trip length', prompt: 'How long is your usual trip?', options: tripLengths,
    format: value => value === 1 ? '1 day' : `${value} days`},
  {key: 'budget', label: 'Group budget', prompt: 'What’s your usual budget for the whole trip?',
    hint: 'Use Indian rupees for the whole group. You can set a different amount for each trip.',
    kind: 'budget', options: [10000, 25000, 50000, 100000], format: money},
  {key: 'stayPreferences', label: 'Stays', prompt: 'Where do you like to stay?',
    hint: 'Choose as many types of accommodation as you like.', options: preferences.stays, kind: 'multi'},
  {key: 'diet', label: 'Food', prompt: 'Should I keep a dietary preference in mind?', options: preferences.diets},
  {key: 'interests', label: 'Interests', prompt: 'What do you like to do on a trip?',
    hint: 'Choose as many interests as you like.', options: preferences.interests, kind: 'multi'},
  {key: 'style', label: 'Travel style', prompt: 'What would you most like a trip to be built around?',
    options: preferences.styles, format: value => value === 'Balanced' ? 'A bit of everything' : value},
  {key: 'pace', label: 'Pace', prompt: 'How much do you like to fit into each day?', options: preferences.paces},
  {key: 'transport', label: 'Transport', prompt: 'How do you prefer to get around?', options: preferences.transport,
    format: value => value === 'Any' ? 'No preference' : value},
  {key: 'mobility', label: 'Getting around comfortably', prompt: 'What would make the trip easier to get around?',
    options: preferences.mobility},
  {key: 'notes', label: 'Other preferences', prompt: 'Is there anything else you’d like me to keep in mind?',
    kind: 'notes', limit: 500, placeholder: 'For example, quieter mornings or step-free hotels'},
]

function newProfile(name, initial) {
  const profile = {...defaultProfile}
  for (const question of questions) {
    const value = initial?.[question.key]
    if (question.kind === 'multi' && Array.isArray(value)) {
      profile[question.key] = [...new Set(value.filter(item => question.options.includes(item)))]
    } else if (question.kind === 'budget' && Number.isInteger(value) && value >= 1000 && value <= 10000000) {
      profile.budget = value
    } else if (question.options?.includes(value)) {
      profile[question.key] = value
    } else if (question.limit && typeof value === 'string') {
      profile[question.key] = value.trim().slice(0, question.limit)
    }
  }
  if (!profile.preferredName && typeof name === 'string') profile.preferredName = name.trim().slice(0, 70)
  return profile
}

function answerText(question, value) {
  if (question.kind === 'multi') return value.length ? value.join(', ') : 'No preference'
  if (value === '') return 'Skipped'
  return question.format ? question.format(value) : value
}

function ChoiceList({question, value, onChange, locked}) {
  const multiple = question.kind === 'multi'
  return <fieldset className="onboarding-chat-choices" disabled={locked}>
    <legend className="sr-only">{question.label}</legend>
    {question.options.map(option => {
      const selected = multiple ? value.includes(option) : String(value) === String(option)
      return <button key={option} type="button" aria-pressed={selected}
        onClick={() => onChange(multiple ? selected ? value.filter(item => item !== option) : [...value, option] : option)}>
        {selected && <Check size={15} aria-hidden="true"/>}
        {question.format ? question.format(option) : option}
      </button>
    })}
  </fieldset>
}

function AssistantMessage({children}) {
  return <li className="onboarding-chat-assistant">
    <span className="onboarding-chat-avatar" aria-hidden="true"><Sparkles size={18}/></span>
    <div className="onboarding-chat-bubble"><span className="sr-only">YatraBuddy:</span>{children}</div>
  </li>
}

export function OnboardingChat({name, initial, onDone, onSignOut}) {
  const [profile, setProfile] = useState(() => newProfile(name, initial))
  const [step, setStep] = useState(0)
  const [answered, setAnswered] = useState(0)
  const [returnStep, setReturnStep] = useState(null)
  const [draft, setDraft] = useState(profile.preferredName)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const prompt = useRef(null)
  const viewport = useRef(null)
  const first = useRef(true)
  const question = questions[step]
  const reviewing = !question
  const editing = returnStep != null
  const completed = Math.min(answered, questions.length)
  const isFirst = step === 0 && !editing && !completed
  const greeting = typeof name === 'string' ? name.trim().split(/\s+/)[0] : ''

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    prompt.current?.focus({preventScroll: true})
    viewport.current?.scrollTo({top: viewport.current.scrollHeight, behavior: reduced ? 'instant' : 'smooth'})
  }, [step, editing, answered])

  function selectStep(index, values = profile, resumeAt = null) {
    setStep(index)
    setReturnStep(resumeAt)
    setDraft(questions[index] ? values[questions[index].key] : '')
    setError('')
  }

  function complete(value) {
    if (busy || !question) return
    const next = {...profile, [question.key]: value}
    if (question.key === 'travelGroup' && completed <= step + 1 && groupSizes[value]) {
      next.travelers = groupSizes[value]
    }
    setProfile(next)
    setAnswered(Math.max(answered, step + 1))
    selectStep(returnStep ?? step + 1, next)
  }

  function submit(event) {
    event.preventDefault()
    let value = draft
    if (question.kind === 'budget') {
      value = Number(draft)
      if (!Number.isInteger(value) || value < 1000 || value > 10000000) {
        setError('Enter a budget from ₹1,000 to ₹1,00,00,000.')
        return
      }
    }
    if (question.limit) value = draft.trim()
    complete(value)
  }

  async function run(action, callback) {
    if (busy || !callback) return
    setBusy(action)
    setError('')
    try {
      await callback()
    } catch (failure) {
      setError(failure?.message || (action === 'save' ? 'Couldn’t save your profile. Try again.' : 'Couldn’t sign out. Try again.'))
    } finally {
      setBusy('')
    }
  }

  const stepLabel = reviewing ? 'Review your answers' : `Question ${step + 1} of ${questions.length}`
  const fallback = question?.key === 'preferredName' ? profile.preferredName : question && defaultProfile[question.key]
  const skipLabel = question?.kind === 'budget' ? 'Use default budget' :
    emptyChoices.has(question?.key) ? 'No preference' : 'Skip'

  return <main className="onboarding-chat" aria-labelledby="onboarding-title">
    <header className="onboarding-chat-header">
      <span className="onboarding-chat-brand"><Brand/></span>
      {onSignOut && <Button icon="logout" disabled={Boolean(busy)} onClick={() => run('logout', onSignOut)}>
        {busy === 'logout' ? 'Signing out…' : 'Sign out'}
      </Button>}
    </header>
    <section className="onboarding-chat-panel" aria-label="Travel profile conversation">
      <div className="onboarding-chat-intro">
        <div><h1 id="onboarding-title">Your travel profile</h1>
          <p>Tell me how you like to travel so I can tailor your plans.</p></div>
        <div className="onboarding-chat-progress">
          <span>{stepLabel}</span>
          <progress max={questions.length} value={completed} aria-label="Travel profile questions answered"/>
        </div>
      </div>
      <div className="onboarding-chat-viewport" ref={viewport} tabIndex={0} aria-label="Conversation history">
        <ol className="onboarding-chat-transcript">
          <AssistantMessage><p>{greeting ? `Hi ${greeting}! I’m your travel buddy.` : 'Hi! I’m your travel buddy.'}
            {' '}You can change these preferences later.</p></AssistantMessage>
          {questions.slice(0, completed).map((previous, index) => <React.Fragment key={previous.key}>
            <AssistantMessage><p>{previous.prompt}</p></AssistantMessage>
            <li className="onboarding-chat-user">
              <span className="onboarding-chat-bubble"><span className="sr-only">You:</span>{answerText(previous, profile[previous.key])}</span>
              <button type="button" aria-label={`Edit ${previous.label.toLowerCase()}`} title={`Edit ${previous.label.toLowerCase()}`}
                onClick={() => selectStep(index, profile, returnStep ?? step)} disabled={Boolean(busy)}><Pencil size={16} aria-hidden="true"/></button>
            </li>
          </React.Fragment>)}
          <AssistantMessage>
            <h2 id="onboarding-prompt" ref={prompt} tabIndex={-1}>{reviewing ? 'Ready to save your travel profile?' : question.prompt}</h2>
            {reviewing ? <p>Use the edit button beside any answer to make a change.</p> : question.hint && <p>{question.hint}</p>}
          </AssistantMessage>
        </ol>
      </div>
      {reviewing ? <footer className="onboarding-chat-composer">
        {error && <p className="onboarding-chat-error" role="alert">{error}</p>}
        <Button variant="primary" icon="check" disabled={Boolean(busy)} onClick={() => run('save', () => onDone(profile))}>
          {busy === 'save' ? 'Saving preferences…' : 'Save preferences'}
        </Button>
      </footer> : <form className="onboarding-chat-composer" aria-labelledby="onboarding-prompt" onSubmit={submit}>
        {question.options && <ChoiceList question={question} value={draft} onChange={value => {setDraft(value); setError('')}}
          locked={Boolean(busy)}/>}
        {question.key === 'homeCity' && <div className="onboarding-chat-city">
          <DestinationSearch catalog={[]} global label="Usual departure city" placeholder="Search or enter a city"
            inputValue={draft} onInputChange={value => {setDraft(value); setError('')}}
            onSelect={place => {setDraft(place.name); setError('')}} maxLength={question.limit} disabled={Boolean(busy)}/>
        </div>}
        {['text', 'budget', 'notes'].includes(question.kind) && question.key !== 'homeCity' && <label className="onboarding-chat-input">
          <span className="sr-only">{question.label}</span>
          {question.kind === 'notes' ? <textarea rows={3} maxLength={question.limit} placeholder={question.placeholder}
            value={draft} disabled={Boolean(busy)} onChange={event => setDraft(event.target.value)}/> :
            <input type={question.kind === 'budget' ? 'number' : 'text'}
              min={question.kind === 'budget' ? 1000 : undefined} max={question.kind === 'budget' ? 10000000 : undefined}
              step={question.kind === 'budget' ? 1 : undefined} inputMode={question.kind === 'budget' ? 'numeric' : undefined}
              maxLength={question.limit} placeholder={question.placeholder} autoComplete={question.autocomplete}
              value={draft} disabled={Boolean(busy)} onChange={event => {setDraft(event.target.value); setError('')}}/>}
        </label>}
        {error && <p className="onboarding-chat-error" role="alert">{error}</p>}
        <div className="onboarding-chat-actions">
          {!isFirst && <Button variant="text-btn" disabled={Boolean(busy)} onClick={() =>
            editing ? selectStep(returnStep) : selectStep(Math.max(0, step - 1))}>
            <ArrowLeft size={16} aria-hidden="true"/>{editing ? returnStep === questions.length ? 'Back to review' : 'Cancel edit' : 'Back'}
          </Button>}
          <Button variant="text-btn" disabled={Boolean(busy)} onClick={() => complete(fallback)}>{skipLabel}</Button>
          <Button type="submit" variant="primary" disabled={Boolean(busy) || (question.kind === 'budget' && draft === '')}>
            {editing ? 'Update answer' : 'Send answer'} <ArrowUp size={16} aria-hidden="true"/>
          </Button>
        </div>
      </form>}
    </section>
    <p className="onboarding-chat-footnote"><Compass size={15} aria-hidden="true"/>You can override these preferences for any trip.</p>
  </main>
}
