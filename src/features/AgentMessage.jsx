import React, {useEffect, useEffectEvent, useState} from 'react'
import {Check, CircleAlert, Copy, LoaderCircle} from 'lucide-react'
import './AgentMessage.css'

const inlinePattern = /(!?\[([^\]\n]+)\]\(([^()\s]+)\))|(\*\*([^*\n]+)\*\*)|(`([^`\n]+)`)|(\*([^*\n]+)\*)/g
const listLine = /^\s*(- |\* |\d+\. )(.+)$/
const wordEnd = /\S+\s*/gu

function inline(line) {
  const parts = []
  let cursor = 0
  for (const match of line.matchAll(inlinePattern)) {
    const [raw, link, label, url, , bold, , code, , italic] = match
    parts.push(line.slice(cursor, match.index))
    const key = match.index
    if (bold) parts.push(<strong key={key}>{bold}</strong>)
    else if (code) parts.push(<code key={key}>{code}</code>)
    else if (italic) parts.push(<em key={key}>{italic}</em>)
    else if (link && !raw.startsWith('!') && /^https?:\/\//i.test(url)) {
      parts.push(<a key={key} href={url} target="_blank" rel="noreferrer">{label}</a>)
    } else parts.push(label)
    cursor = match.index + raw.length
  }
  parts.push(line.slice(cursor))
  return parts
}

function CodeBlock({code, language, pending}) {
  const [status, setStatus] = useState('')
  useEffect(() => {
    if (!status) return
    const timeout = setTimeout(() => setStatus(''), 2200)
    return () => clearTimeout(timeout)
  }, [status])
  return <div className="agent-code-block">
    <div><span>{language || 'Code'}</span><button type="button" disabled={pending} onClick={async () => {
      try {await navigator.clipboard.writeText(code);setStatus('Copied')}
      catch {setStatus('Copy unavailable')}
    }}>{status === 'Copied' ? <Check size={14}/> : <Copy size={14}/>} {status || 'Copy code'}</button></div>
    <pre><code>{code}</code></pre>
  </div>
}

export function RevealingAnswer({text, onComplete}) {
  const [visible, setVisible] = useState('')
  const finish = useEffectEvent(onComplete)
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (motion.matches) {
      finish()
      return
    }
    const ends = Array.from(text.matchAll(wordEnd), match => match.index + match[0].length)
    const duration = Math.min(1800, Math.max(330, ends.length * 28))
    const start = performance.now()
    const timer = window.setInterval(() => {
      const count = Math.max(1, Math.floor((performance.now() - start) / duration * ends.length))
      if (count >= ends.length || motion.matches) {
        window.clearInterval(timer)
        finish()
      } else {
        setVisible(text.slice(0, ends[count - 1]))
      }
    }, 32)
    return () => window.clearInterval(timer)
  }, [text])
  return <div aria-hidden="true"><AgentMessage text={visible} pending/></div>
}

function ChecklistItem({text}) {
  return <label className="agent-checklist-item"><input type="checkbox"/><span>{inline(text)}</span></label>
}

export const AgentMessage = React.memo(function AgentMessage({text, kind, pending = false}) {
  const lines = text.trim().split(/\r?\n/)
  const content = []
  for (let index = 0; index < lines.length;) {
    const key = index
    const line = lines[index++]
    if (!line.trim()) continue
    const fence = line.match(/^\s*```([\w+-]*)\s*$/)
    if (fence) {
      const block = []
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) block.push(lines[index++])
      const complete = index < lines.length
      if (complete) index++
      content.push(<CodeBlock key={key} code={block.join('\n')} language={fence[1]} pending={pending && !complete}/>)
      continue
    }
    const item = line.match(listLine)
    const heading = line.match(/^#{1,6}\s+(.+)$/)
    if (item) {
      const ordered = /^\d/.test(item[1])
      const items = [item[2]]
      while (index < lines.length) {
        const next = lines[index].match(listLine)
        if (!next || /^\d/.test(next[1]) !== ordered) break
        items.push(next[2])
        index += 1
      }
      const List = ordered ? 'ol' : 'ul'
      content.push(<List key={key}>{items.map((value, position) => <li key={position}>{!pending && value.startsWith('[ ] ')
        ? <ChecklistItem text={value.slice(4)}/> : inline(value)}</li>)}</List>)
    } else if (heading) content.push(<p className="agent-markdown-heading" key={key}>{inline(heading[1])}</p>)
    else content.push(<p key={key}>{inline(line)}</p>)
  }
  return <div className="agent-markdown" data-pending={pending || undefined}>
    {content}
    {kind === 'general' && <small className="agent-answer-label">General knowledge · verify before relying</small>}
  </div>
})

export function AgentToolStatus({tools, running = false}) {
  if (!tools.length) return null
  const unavailable = tools.filter(tool => tool.status === 'fallback').length
  const complete = tools.filter(tool => tool.status === 'done').length
  const items = <ul>{tools.map(tool => {
    const inProgress = tool.status === 'running'
    const fallback = tool.status === 'fallback'
    const StatusIcon = inProgress ? LoaderCircle : fallback ? CircleAlert : Check
    return <li key={tool.id || tool.name} data-tool-state={tool.status}><StatusIcon size={16} aria-hidden="true"/>
      <span>{tool.name}{typeof tool.detail === 'string' && tool.detail.trim() && <small className="agent-tool-detail">{tool.detail}</small>}</span>
      <small>{inProgress ? 'Checking' : fallback ? 'Unavailable' : 'Complete'}</small>
    </li>
  })}</ul>
  return running ? <div className="agent-tool-status" aria-label="Current lookups">{items}</div> : <details className="agent-tool-status">
    <summary>Lookup activity · {complete} completed{unavailable > 0 && ` · ${unavailable} unavailable`}</summary>{items}
  </details>
}
